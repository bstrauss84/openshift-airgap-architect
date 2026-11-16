/**
 * Verified catalog fetch (v2.2.0 M7).
 *
 * Pulls one image (an operator catalog) from its registry with:
 *  - TLS verified against the trust oc-mirror uses (registryTrust.js); no
 *    option here or anywhere turns verification off;
 *  - the corporate proxy honoured exactly like the rest of the backend
 *    (configureFetchProxy.js: HTTP(S)_PROXY, NO_PROXY incl. CIDRs), with the
 *    target certificate verified through the CONNECT tunnel;
 *  - registry token / basic authentication from a pull secret, sent only to
 *    HTTPS endpoints the registry named, never forwarded across a redirect to
 *    another origin (blob downloads redirect to CDNs with signed URLs);
 *  - every manifest and blob checked against its SHA-256 digest and size;
 *  - bounded retries for transient transport failures only (connection reset,
 *    truncated body, 429/5xx) — never for certificate, authentication,
 *    not-found or integrity failures.
 *
 * The result is an OCI image layout keyed by the digest the reference resolved
 * to. Failures carry a `code` the UI can explain (TLS_UNTRUSTED,
 * AUTH_REQUIRED, AUTH_DENIED, NOT_FOUND, PROXY_AUTH, UNREACHABLE, INTEGRITY,
 * UNSUPPORTED, ABORTED, FAILED).
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { fetch } from "undici";
import { CidrAwareEnvHttpProxyAgent } from "./configureFetchProxy.js";
import { registryTrustFor } from "./registryTrust.js";
import { parseImageReference } from "./imagesetConfigValidator.js";

export const MANIFEST_TYPES = {
  ociIndex: "application/vnd.oci.image.index.v1+json",
  ociManifest: "application/vnd.oci.image.manifest.v1+json",
  dockerList: "application/vnd.docker.distribution.manifest.list.v2+json",
  dockerManifest: "application/vnd.docker.distribution.manifest.v2+json"
};
const ACCEPT = Object.values(MANIFEST_TYPES).join(", ");
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;

export class RegistryError extends Error {
  constructor(code, message, { cause, status } = {}) {
    super(message);
    this.code = code;
    if (status) this.status = status;
    if (cause) this.cause = cause;
  }
}

const TLS_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID",
  "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_UNTRUSTED", "CERT_REJECTED", "CERT_SIGNATURE_FAILURE", "INVALID_CA"
]);
const TRANSIENT_CODES = new Set([
  "ECONNRESET", "EPIPE", "ETIMEDOUT", "UND_ERR_SOCKET", "UND_ERR_CLOSED", "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "ERR_STREAM_PREMATURE_CLOSE", "TRUNCATED"
]);
const UNREACHABLE_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]);

/** The innermost error code in a fetch failure chain. */
const rootCode = (err) => {
  let e = err;
  for (let i = 0; e && i < 6; i++) {
    if (e.code && (TLS_CODES.has(e.code) || TRANSIENT_CODES.has(e.code) || UNREACHABLE_CODES.has(e.code))) return e.code;
    e = e.cause;
  }
  return err?.cause?.code || err?.code || null;
};

/**
 * The HTTPS proxy undici uses for registry requests (same precedence as
 * EnvHttpProxyAgent), as host and port only — a proxy URL can hold credentials.
 */
export function configuredHttpsProxy(env = process.env) {
  const raw = env.https_proxy ?? env.HTTPS_PROXY ?? env.http_proxy ?? env.HTTP_PROXY;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return { host: u.hostname.replace(/^\[|\]$/g, ""), port: Number(u.port) || (u.protocol === "https:" ? 443 : 80) };
  } catch {
    return null;
  }
}

/** Every socket-level endpoint named in a failure chain (incl. happy-eyeballs AggregateErrors). */
const failedEndpoints = (err) => {
  const out = [];
  const visit = (e, depth) => {
    if (!e || depth > 6) return;
    if (e.hostname || e.address) out.push({ hostname: e.hostname, address: e.address, port: e.port });
    if (Array.isArray(e.errors)) for (const x of e.errors) visit(x, depth + 1);
    visit(e.cause, depth + 1);
  };
  visit(err, 0);
  return out;
};

/**
 * True when a connection failure was the proxy's, not the registry's: the
 * refused or unresolved endpoint is the proxy — its address and port, or, for a
 * proxy given by name, that name or its port when the registry uses another
 * port. A NO_PROXY bypass reaches the registry directly and does not match.
 */
const failedAtProxy = (err, host, proxy) => {
  if (!proxy) return false;
  const proxyIsAddress = net.isIP(proxy.host) !== 0;
  const targetPort = Number(new URL(`https://${host}`).port) || 443;
  return failedEndpoints(err).some((e) => {
    if (e.hostname) return e.hostname === proxy.host;
    if (proxyIsAddress) return e.address === proxy.host && e.port === proxy.port;
    return e.port === proxy.port && proxy.port !== targetPort;
  });
};

/** Map a transport failure to a RegistryError (TLS failures are never transient). */
export function classifyTransportError(err, host, env = process.env) {
  if (err instanceof RegistryError) return err;
  if (err?.name === "AbortError") return new RegistryError("ABORTED", "Stopped.", { cause: err });
  const code = rootCode(err);
  if (code && TLS_CODES.has(code)) {
    return new RegistryError("TLS_UNTRUSTED", `The certificate presented for ${host} could not be verified (${code}). Nothing was sent to it. If a corporate proxy re-signs HTTPS, add its CA to the container's trust (system store, SSL_CERT_FILE / SSL_CERT_DIR, or /etc/containers/certs.d/${host}/ca.crt) — the same trust oc-mirror uses.`, { cause: err });
  }
  if (code && UNREACHABLE_CODES.has(code)) {
    const proxy = configuredHttpsProxy(env);
    if (failedAtProxy(err, host, proxy)) {
      return new RegistryError("UNREACHABLE", `The HTTPS proxy ${proxy.host}:${proxy.port} configured for the Architect backend could not be reached (${code}), so ${host} was not contacted and no credential was sent. Check the backend's HTTPS_PROXY / NO_PROXY settings, or use a machine with access to ${host}.`, { cause: err });
    }
    return new RegistryError("UNREACHABLE", `${host} could not be reached (${code}). Check this machine's network access to ${host}${proxy ? ` and the backend's proxy settings (HTTPS_PROXY ${proxy.host}:${proxy.port}, NO_PROXY)` : " (and HTTPS_PROXY if a proxy is required)"}.`, { cause: err });
  }
  if (code && TRANSIENT_CODES.has(code)) return new RegistryError("TRANSIENT", `The connection to ${host} was interrupted (${code}).`, { cause: err });
  return new RegistryError("FAILED", `The request to ${host} failed: ${String(err?.cause?.message || err?.message || err)}`, { cause: err });
}

/** Registry API host and repository for a parsed reference (Docker Hub rules). */
export function registryCoordinates(reference) {
  const ref = parseImageReference(reference);
  if (!ref) throw new RegistryError("UNSUPPORTED", `${reference} is not an image reference.`);
  if (!ref.tag && !ref.digest) throw new RegistryError("UNSUPPORTED", `${reference} has neither a tag nor a digest.`);
  let host = ref.registry || "docker.io";
  let repository = ref.repository;
  if (host === "docker.io" || host === "index.docker.io") {
    host = "registry-1.docker.io";
    if (!repository.includes("/")) repository = `library/${repository}`;
  }
  // Pull-secret keys for Docker Hub entries ("docker.io", "index.docker.io",
  // and the legacy "<scheme>://index.docker.io/v1/" form, which credentialsFor
  // tries for every host). They name credentials; index.docker.io is never contacted.
  return { host, authHosts: ref.registry ? [ref.registry] : ["docker.io", "index.docker.io", "index.docker.io/v1/"], repository, tag: ref.tag, digest: ref.digest };
}

/** Basic credentials for a registry from a pull-secret file, or null. */
export function credentialsFor(authFile, hosts) {
  if (!authFile) return null;
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(authFile, "utf8"));
  } catch {
    return null;
  }
  const auths = doc?.auths && typeof doc.auths === "object" ? doc.auths : {};
  for (const h of hosts) {
    for (const key of [h, `https://${h}`, `http://${h}`]) {
      const entry = auths[key];
      if (entry?.auth && typeof entry.auth === "string") return entry.auth;
      if (entry?.username && entry?.password) return Buffer.from(`${entry.username}:${entry.password}`).toString("base64");
    }
  }
  return null;
}

/** Parse a WWW-Authenticate header into { scheme, params }. */
export function parseChallenge(header) {
  if (!header) return null;
  const m = /^\s*(\w+)\s*(.*)$/s.exec(header);
  if (!m) return null;
  const params = {};
  for (const p of m[2].matchAll(/(\w+)="([^"]*)"/g)) params[p[1].toLowerCase()] = p[2];
  return { scheme: m[1].toLowerCase(), params };
}

const archName = (a = process.arch) => ({ x64: "amd64", arm64: "arm64", ppc64: "ppc64le", s390x: "s390x" }[a] || a);
const sha256hex = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/**
 * One registry client: dispatcher with the right trust, token cache, retries.
 * @param {{ host: string, authHosts: string[], repository: string }} coords
 */
export function createRegistryClient(coords, { authFile = null, env = process.env, signal = null, retries = 3, retryDelayMs = 500, dispatcherOptions = {} } = {}) {
  const trust = registryTrustFor(coords.host, { env });
  const tls = { ca: trust.ca, rejectUnauthorized: true };
  // Target TLS: `connect` (direct) and `requestTls` (through a proxy tunnel);
  // `proxyTls` for an HTTPS proxy endpoint itself.
  const dispatcher = new CidrAwareEnvHttpProxyAgent({ connect: tls, requestTls: tls, proxyTls: tls, ...dispatcherOptions });
  const basic = credentialsFor(authFile, coords.authHosts);
  let authorization = null;
  const base = `https://${coords.host}`;

  const once = async (url, { headers = {}, auth = true } = {}) => {
    const h = { ...headers };
    if (auth && authorization) h.Authorization = authorization;
    try {
      return await fetch(url, { headers: h, redirect: "manual", dispatcher, signal });
    } catch (err) {
      throw classifyTransportError(err, new URL(url).host, env);
    }
  };

  const withRetry = async (fn) => {
    let last;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn(attempt);
      } catch (err) {
        last = err;
        if (!(err instanceof RegistryError) || err.code !== "TRANSIENT" || attempt === retries) throw err;
        await new Promise((r) => setTimeout(r, retryDelayMs * 2 ** attempt));
      }
    }
    throw last;
  };

  const authenticate = async (challenge) => {
    if (!challenge) throw new RegistryError("AUTH_REQUIRED", `${coords.host} requires authentication but did not say how.`);
    if (challenge.scheme === "basic") {
      if (!basic) throw new RegistryError("AUTH_REQUIRED", `${coords.host} requires credentials; none were given for it (no pull secret, or no entry for ${coords.host} in it).`);
      authorization = `Basic ${basic}`;
      return;
    }
    if (challenge.scheme !== "bearer" || !challenge.params.realm) throw new RegistryError("AUTH_REQUIRED", `${coords.host} asked for an unsupported authentication scheme.`);
    const realm = new URL(challenge.params.realm);
    if (realm.protocol !== "https:") throw new RegistryError("AUTH_DENIED", `${coords.host} named a token service that is not HTTPS; credentials were not sent.`);
    realm.searchParams.set("scope", challenge.params.scope || `repository:${coords.repository}:pull`);
    if (challenge.params.service) realm.searchParams.set("service", challenge.params.service);
    const res = await once(realm.toString(), { headers: basic ? { Authorization: `Basic ${basic}` } : {}, auth: false });
    if (res.status === 401 || res.status === 403) {
      // Without credentials this is a refusal of anonymous access, not of a password.
      if (!basic) throw new RegistryError("AUTH_REQUIRED", `${coords.host} requires credentials; none were given for it (no pull secret, or no entry for ${coords.host} in it).`, { status: res.status });
      throw new RegistryError("AUTH_DENIED", `The token service for ${coords.host} refused the credentials (${res.status}).`, { status: res.status });
    }
    if (!res.ok) throw new RegistryError(res.status >= 500 ? "TRANSIENT" : "FAILED", `The token service for ${coords.host} answered ${res.status}.`, { status: res.status });
    const body = await res.json().catch(() => ({}));
    const token = body.token || body.access_token;
    if (!token) throw new RegistryError("AUTH_DENIED", `The token service for ${coords.host} returned no token.`);
    authorization = `Bearer ${token}`;
  };

  /** GET with auth negotiation and same-origin-only credential forwarding on redirects. */
  const get = (pathOrUrl, headers = {}) => withRetry(async () => {
    let url = pathOrUrl.startsWith("https://") ? pathOrUrl : `${base}${pathOrUrl}`;
    let triedAuth = false;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const sameOrigin = new URL(url).origin === base;
      const res = await once(url, { headers, auth: sameOrigin });
      if (res.status === 401 && sameOrigin && !triedAuth) {
        triedAuth = true;
        await res.arrayBuffer().catch(() => {});
        await authenticate(parseChallenge(res.headers.get("www-authenticate")));
        hop--;
        continue;
      }
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get("location");
        await res.arrayBuffer().catch(() => {});
        if (!loc) throw new RegistryError("FAILED", `${coords.host} redirected without a location.`);
        const next = new URL(loc, url);
        if (next.protocol !== "https:") throw new RegistryError("FAILED", `${coords.host} redirected to a non-HTTPS location; not followed.`);
        url = next.toString();
        continue;
      }
      if (res.status === 401) throw new RegistryError(basic ? "AUTH_DENIED" : "AUTH_REQUIRED", basic ? `${coords.host} refused the credentials (401).` : `${coords.host} requires credentials; none were given for it (no pull secret, or no entry for ${coords.host} in it).`, { status: 401 });
      if (res.status === 403) throw new RegistryError("AUTH_DENIED", `${coords.host} denied access to ${coords.repository} (403).`, { status: 403 });
      if (res.status === 404) throw new RegistryError("NOT_FOUND", `${coords.host}/${coords.repository} has no such manifest or blob (404).`, { status: 404 });
      if (res.status === 407) throw new RegistryError("PROXY_AUTH", "The HTTP proxy requires authentication (407). Put the proxy credentials in HTTPS_PROXY.", { status: 407 });
      if (res.status === 429 || res.status >= 500) {
        await res.arrayBuffer().catch(() => {});
        throw new RegistryError("TRANSIENT", `${new URL(url).host} answered ${res.status}.`, { status: res.status });
      }
      if (!res.ok) throw new RegistryError("FAILED", `${new URL(url).host} answered ${res.status}.`, { status: res.status });
      return res;
    }
    throw new RegistryError("FAILED", `${coords.host}: too many redirects.`);
  });

  return { coords, trust, env, get, close: () => dispatcher.close() };
}

/** Fetch a manifest by tag or digest and verify it. */
async function fetchManifest(client, ref) {
  const res = await client.get(`/v2/${client.coords.repository}/manifests/${ref}`, { Accept: ACCEPT });
  const len = Number(res.headers.get("content-length") || 0);
  if (len > MAX_MANIFEST_BYTES) throw new RegistryError("UNSUPPORTED", "The manifest is larger than OAA accepts.");
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_MANIFEST_BYTES) throw new RegistryError("UNSUPPORTED", "The manifest is larger than OAA accepts.");
  const digest = `sha256:${sha256hex(bytes)}`;
  if (DIGEST_RE.test(ref) && digest !== ref) throw new RegistryError("INTEGRITY", `The manifest served for ${ref} has digest ${digest}.`);
  const header = res.headers.get("docker-content-digest");
  if (header && DIGEST_RE.test(header) && header !== digest) throw new RegistryError("INTEGRITY", `The registry labelled the manifest ${header} but its content is ${digest}.`);
  let doc;
  try {
    doc = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new RegistryError("UNSUPPORTED", "The manifest is not JSON.");
  }
  const mediaType = doc.mediaType || res.headers.get("content-type")?.split(";")[0] || "";
  return { bytes, digest, doc, mediaType };
}

/** Stream a blob into the layout, verifying size and digest; reuse a verified copy. */
async function fetchBlob(client, desc, blobsDir) {
  if (!DIGEST_RE.test(desc.digest)) throw new RegistryError("UNSUPPORTED", `Unsupported blob digest ${desc.digest}.`);
  const final = path.join(blobsDir, desc.digest.slice(7));
  if (fs.existsSync(final) && fs.statSync(final).size === desc.size) return final;
  const tmp = `${final}.part-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  try {
    await (async () => {
      const res = await client.get(`/v2/${client.coords.repository}/blobs/${desc.digest}`);
      const hash = crypto.createHash("sha256");
      let seen = 0;
      const meter = new Transform({
        transform(chunk, _enc, cb) {
          seen += chunk.length;
          if (seen > desc.size) return cb(new RegistryError("INTEGRITY", `Blob ${desc.digest} is larger than its descriptor says.`));
          hash.update(chunk);
          cb(null, chunk);
        }
      });
      try {
        await pipeline(Readable.fromWeb(res.body), meter, fs.createWriteStream(tmp, { mode: 0o600 }));
      } catch (err) {
        throw err instanceof RegistryError ? err : classifyTransportError(Object.assign(err, { code: err.code || "TRUNCATED" }), client.coords.host, client.env);
      }
      if (seen !== desc.size) throw new RegistryError("TRANSIENT", `Blob ${desc.digest} ended after ${seen} of ${desc.size} bytes.`);
      const got = `sha256:${hash.digest("hex")}`;
      if (got !== desc.digest) throw new RegistryError("INTEGRITY", `Blob content ${got} does not match ${desc.digest}.`);
    })();
    fs.renameSync(tmp, final);
    return final;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * Pull `reference` into an OCI layout under `cacheRoot`, verified end to end.
 * @returns {Promise<{ reference, host, repository, tag, resolvedDigest, manifestDigest, layoutDir, trustSources, fetchedAt }>}
 */
export async function fetchVerifiedImage(reference, { authFile = null, cacheRoot, env = process.env, signal = null, arch = archName(), onProgress = null, retries, retryDelayMs, dispatcherOptions } = {}) {
  const coords = registryCoordinates(reference);
  const client = createRegistryClient(coords, { authFile, env, signal, retries, retryDelayMs, dispatcherOptions });
  try {
    const top = await fetchManifest(client, coords.digest || coords.tag);
    const resolvedDigest = top.digest;
    let manifest = top;
    const isIndex = [MANIFEST_TYPES.ociIndex, MANIFEST_TYPES.dockerList].includes(top.mediaType) || Array.isArray(top.doc.manifests);
    if (isIndex) {
      const pick = (top.doc.manifests || []).find((m) => m.platform?.os === "linux" && m.platform?.architecture === arch);
      if (!pick) throw new RegistryError("UNSUPPORTED", `${reference} has no linux/${arch} image.`);
      manifest = await fetchManifest(client, pick.digest);
    }
    if (![MANIFEST_TYPES.ociManifest, MANIFEST_TYPES.dockerManifest].includes(manifest.mediaType) || !manifest.doc.config) {
      throw new RegistryError("UNSUPPORTED", `${reference} is not an image manifest OAA can read (${manifest.mediaType || "unknown"}).`);
    }
    const layoutDir = path.join(cacheRoot, coords.host.replace(/[^A-Za-z0-9.-]/g, "_"), coords.repository.replace(/[^A-Za-z0-9._-]/g, "_"), manifest.digest.slice(7));
    const blobsDir = path.join(layoutDir, "blobs", "sha256");
    fs.mkdirSync(blobsDir, { recursive: true });
    const descs = [manifest.doc.config, ...(manifest.doc.layers || [])];
    const total = descs.reduce((n, d) => n + (Number(d.size) || 0), 0);
    let done = 0;
    for (const d of descs) {
      if (!Number.isSafeInteger(d.size) || d.size < 0) throw new RegistryError("UNSUPPORTED", `Blob ${d.digest} has no valid size.`);
      await fetchBlob(client, d, blobsDir);
      done += d.size;
      onProgress?.({ done, total });
    }
    for (const m of isIndex ? [top, manifest] : [manifest]) fs.writeFileSync(path.join(blobsDir, m.digest.slice(7)), m.bytes);
    fs.writeFileSync(path.join(layoutDir, "oci-layout"), '{"imageLayoutVersion":"1.0.0"}');
    fs.writeFileSync(path.join(layoutDir, "index.json"), JSON.stringify({
      schemaVersion: 2,
      manifests: [{ mediaType: manifest.mediaType, digest: manifest.digest, size: manifest.bytes.length, annotations: { "org.opencontainers.image.ref.name": coords.tag || manifest.digest } }]
    }));
    return {
      reference,
      host: coords.host,
      repository: coords.repository,
      tag: coords.tag,
      resolvedDigest,
      manifestDigest: manifest.digest,
      layoutDir,
      trustSources: client.trust.sources,
      fetchedAt: Date.now()
    };
  } finally {
    await client.close().catch(() => {});
  }
}
