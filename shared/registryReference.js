/**
 * OpenShift Airgap Architect - registry reference validation (v2.3.0, owner refinement 5).
 *
 * A mirror registry reference is `host[:port][/path]`: where images go, never how to log in.
 * It is persisted (Upgrade plans, Mirroring profile destinations) and printed into generated
 * commands, so it must never be able to carry a credential. Authentication stays in the
 * memory-only credential context.
 *
 * Refused (the value itself is never echoed back in an error):
 *  - a scheme other than an optional leading docker:// (stripped);
 *  - URL userinfo or any "@" (user:pass@host, digests);
 *  - query strings, fragments, whitespace, control characters, backslashes;
 *  - path segments that look like tokens (long hex or base64-like runs);
 *  - anything that is not a lowercase OCI host and repository path.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */

export const REGISTRY_REFERENCE_MAX = 255;

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
// OCI distribution spec path component: lowercase alphanumerics separated by ., _, __ or -.
const PATH_COMPONENT = /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*$/;
const TOKEN_LIKE = [/^[a-f0-9]{32,}$/, /^[a-z0-9]{40,}$/];

const fail = (reason) => ({ ok: false, code: "REGISTRY_REFERENCE_INVALID", reason });

/**
 * Validate and normalize a registry reference.
 * @returns {{ok:true, value:string, host:string, port:number|null, path:string}|{ok:false, code:string, reason:string}}
 */
export function normalizeRegistryReference(input) {
  if (typeof input !== "string") return fail("Enter the registry as host[:port]/path.");
  let v = input.trim();
  if (!v) return fail("Enter the registry as host[:port]/path.");
  if (v.length > REGISTRY_REFERENCE_MAX + "docker://".length) return fail(`Use at most ${REGISTRY_REFERENCE_MAX} characters.`);
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f\\]/.test(v)) return fail("Spaces, control characters and backslashes are not allowed.");
  if (/^docker:\/\//i.test(v)) v = v.slice("docker://".length);
  if (v.includes("://")) return fail("Leave out the scheme (https://); use host[:port]/path.");
  if (v.includes("@")) return fail("A registry reference cannot contain \"@\": never put a user name, password or token in it. Credentials are entered separately.");
  if (/[?#]/.test(v)) return fail("Query strings and fragments are not allowed.");
  v = v.replace(/\/+$/, "");
  if (v.length > REGISTRY_REFERENCE_MAX) return fail(`Use at most ${REGISTRY_REFERENCE_MAX} characters.`);
  const [hostPort, ...segments] = v.split("/");
  const m = hostPort.match(/^([^:]+)(?::(\d{1,5}))?$/);
  if (!m) return fail("Use host[:port], for example mirror.example.com:8443.");
  const host = m[1].toLowerCase();
  const port = m[2] ? Number(m[2]) : null;
  if (port !== null && (port < 1 || port > 65535)) return fail("The port must be between 1 and 65535.");
  if (!(IPV4.test(host) || (host.length <= 253 && host.split(".").every((l) => HOST_LABEL.test(l))))) return fail("The host must be a DNS name or IPv4 address.");
  if (segments.length > 16) return fail("The path has too many parts.");
  for (const seg of segments) {
    if (!PATH_COMPONENT.test(seg)) return fail("Each path part must use lowercase letters, digits and . _ - only.");
    if (seg.length > 128 || TOKEN_LIKE.some((re) => re.test(seg))) return fail("A path part looks like a token or key. Never put credentials in the registry reference.");
  }
  const path = segments.join("/");
  return { ok: true, value: `${host}${port !== null ? `:${port}` : ""}${path ? `/${path}` : ""}`, host, port, path };
}

export const isValidRegistryReference = (v) => normalizeRegistryReference(v).ok;
