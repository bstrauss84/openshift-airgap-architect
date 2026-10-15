/**
 * Route global fetch() through HTTP_PROXY / HTTPS_PROXY / NO_PROXY (undici).
 * Opt out: AIRGAP_FETCH_USE_ENV_PROXY=false or 0.
 *
 * ── WHY THIS IS NOT JUST `new EnvHttpProxyAgent()` ─────────────────────────
 *
 * undici matches NO_PROXY by exact hostname and dot-suffix ONLY. Its
 * #parseNoProxy stores a CIDR entry as if it were a literal hostname, so
 * `NO_PROXY=10.0.0.0/8` can never match a request to `10.128.0.5` and the
 * request is pushed at the proxy. Reproduced against the shipped undici with
 * a loopback listener standing in for the proxy:
 *
 *     NO_PROXY=10.128.0.5    -> 10.128.0.5  DIRECT    (exact IP: works)
 *     NO_PROXY=10.0.0.0/8    -> 10.128.0.5  PROXIED   (CIDR: ignored)
 *     NO_PROXY=127.0.0.1/32  -> 127.0.0.1   PROXIED   (CIDR: ignored)
 *     NO_PROXY=172.30.0.0/16 -> 10.128.0.5  PROXIED   (correct: no match)
 *
 * The `oc` and `oc-mirror` this backend spawns inherit the SAME environment
 * (index.js passes `{...process.env}`) and DO honour CIDRs, because Go's
 * x/net/http/httpproxy parses them with net.ParseCIDR. So one NO_PROXY
 * variable produced two different routing decisions inside one container —
 * and the product's own guidance pushes CIDRs into NO_PROXY (the UI
 * placeholder and the Field Guide both tell operators to list the machine,
 * service and cluster CIDRs).
 *
 * ── SEMANTICS ARE COPIED FROM GO, DELIBERATELY ─────────────────────────────
 *
 * The point is to make OAA's fetch agree with the tools it spawns, so the
 * matcher mirrors golang.org/x/net/http/httpproxy rather than inventing a
 * third behaviour:
 *
 *   - A CIDR matches only a LITERAL IP host. A hostname that would resolve
 *     into the range is NOT bypassed — Go does not resolve DNS to decide
 *     routing, and neither does this.
 *   - IPv4 and IPv6 never cross-match, even for v4-mapped forms.
 *   - Entries are split on commas only, which is what Go does. undici
 *     additionally splits on whitespace for its own hostname matching; that
 *     pre-existing difference is untouched here. Being deliberately strict
 *     matters: every entry this module matches turns a proxied request into a
 *     DIRECT one, and a false bypass in an airgapped environment is a request
 *     escaping the path the operator intended.
 *
 * Only ADDS bypasses undici missed. Anything it does not recognise falls
 * through to undici's own routing unchanged.
 */
import net from "node:net";
import { EnvHttpProxyAgent, Agent, setGlobalDispatcher } from "undici";

const disabled =
  process.env.AIRGAP_FETCH_USE_ENV_PROXY === "false" ||
  process.env.AIRGAP_FETCH_USE_ENV_PROXY === "0";

/** Bytes of an IPv4/IPv6 literal, or null when it is not an IP at all. */
function ipToBytes(host) {
  const family = net.isIP(host);
  if (family === 4) return host.split(".").map(Number);
  if (family !== 6) return null;
  // Expand "::" and any embedded IPv4 tail into 16 bytes.
  const v4Tail = host.match(/(\d+\.\d+\.\d+\.\d+)$/);
  let text = host;
  if (v4Tail) {
    const quad = v4Tail[1].split(".").map(Number);
    const hi = ((quad[0] << 8) | quad[1]).toString(16);
    const lo = ((quad[2] << 8) | quad[3]).toString(16);
    text = `${host.slice(0, -v4Tail[1].length)}${hi}:${lo}`;
  }
  const [head, tail = ""] = text.split("::");
  const headParts = head ? head.split(":").filter(Boolean) : [];
  const tailParts = tail ? tail.split(":").filter(Boolean) : [];
  const fill = 8 - headParts.length - tailParts.length;
  if (fill < 0) return null;
  const groups = [...headParts, ...Array(text.includes("::") ? fill : 0).fill("0"), ...tailParts];
  if (groups.length !== 8) return null;
  const bytes = [];
  for (const g of groups) {
    const v = parseInt(g, 16);
    if (Number.isNaN(v)) return null;
    bytes.push((v >> 8) & 0xff, v & 0xff);
  }
  return bytes;
}

/** CIDR entries from a NO_PROXY string. Non-CIDR entries are left to undici. */
export function parseNoProxyCidrs(raw) {
  const out = [];
  for (const token of String(raw || "").split(",")) {
    const entry = token.trim();
    if (!entry.includes("/")) continue;
    const [base, bitsText] = entry.split("/");
    const bytes = ipToBytes(base);
    const bits = Number(bitsText);
    if (!bytes || !Number.isInteger(bits) || bits < 0 || bits > bytes.length * 8) continue;
    out.push({ bytes, bits });
  }
  return out;
}

/** Is this literal IP host inside any of the parsed CIDR entries? */
export function hostInNoProxyCidr(host, cidrs) {
  const hostBytes = ipToBytes(host);
  if (!hostBytes) return false; // hostname: Go does not resolve, nor do we
  return cidrs.some(({ bytes, bits }) => {
    if (bytes.length !== hostBytes.length) return false; // never cross families
    let remaining = bits;
    for (let i = 0; i < bytes.length && remaining > 0; i++) {
      const take = Math.min(8, remaining);
      const mask = take === 8 ? 0xff : (0xff << (8 - take)) & 0xff;
      if ((bytes[i] & mask) !== (hostBytes[i] & mask)) return false;
      remaining -= take;
    }
    return true;
  });
}

/**
 * Thin delegating dispatcher.
 *
 * undici's #shouldProxy is a private field, so it cannot be subclassed or
 * patched; routing one extra case means owning the dispatch decision. Every
 * request that is not a CIDR hit is handed to the real EnvHttpProxyAgent
 * untouched, so all of undici's own behaviour — hostname matching, HTTPS
 * proxy selection, port rules — is preserved rather than reimplemented.
 */
export class CidrAwareEnvHttpProxyAgent {
  constructor(options = {}) {
    this.proxyAgent = new EnvHttpProxyAgent(options);
    this.directAgent = new Agent();
    this.noProxyOverride = options.noProxy;
  }

  #bypasses(origin) {
    try {
      // URL keeps IPv6 brackets; the matcher wants the bare address.
      const host = new URL(origin).hostname.replace(/^\[|\]$/g, "");
      if (!net.isIP(host)) return false;
      const raw = this.noProxyOverride ?? process.env.no_proxy ?? process.env.NO_PROXY ?? "";
      return hostInNoProxyCidr(host, parseNoProxyCidrs(raw));
    } catch {
      return false; // unparseable origin: let undici decide
    }
  }

  dispatch(options, handler) {
    const agent = this.#bypasses(options?.origin) ? this.directAgent : this.proxyAgent;
    return agent.dispatch(options, handler);
  }

  close() {
    return Promise.all([this.proxyAgent.close(), this.directAgent.close()]);
  }

  destroy(err) {
    return Promise.all([this.proxyAgent.destroy(err), this.directAgent.destroy(err)]);
  }
}

if (!disabled) {
  setGlobalDispatcher(new CidrAwareEnvHttpProxyAgent());
}
