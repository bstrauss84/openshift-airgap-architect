/**
 * Loopback, read-only registry over a verified OCI layout (v2.2.0 M7).
 *
 * oc-mirror 4.22's `list operators --catalog` accepts only a registry
 * reference (its PreRunE parses it with reference.ParseNamed, so `oci://` is
 * refused before the OCI handling is reached). OAA does not let that listing
 * reach the network at all: it fetches
 * the catalog itself over verified TLS (verifiedRegistry.js) and lets
 * oc-mirror read those bytes from here:
 *
 *  - 127.0.0.1, ephemeral port, plain HTTP, alive only for one listing;
 *  - one repository, manifests and blobs by DIGEST only, GET/HEAD only;
 *  - no credentials: oc-mirror is given no auth file for this hop, so the pull
 *    secret never reaches a connection OAA has not verified.
 *
 * oc-mirror is run with --src-tls-verify=false for this loopback address ONLY
 * (there is no certificate to verify on OAA's own in-process listener). The
 * bytes it reads were verified over TLS and by digest before they got here,
 * and the reference is pinned by digest, which containers/image checks.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

export const LOOPBACK_REPOSITORY = "oaa-verified/catalog";
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;

/**
 * Serve `layoutDir` until close(). `requests` records every request line (tests, evidence).
 * @returns {Promise<{ host: string, reference: (digest: string) => string, requests: string[], close: () => Promise<void> }>}
 */
export function serveLayout(layoutDir) {
  const blobs = path.join(layoutDir, "blobs", "sha256");
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}${req.headers.authorization ? " (authorization header present)" : ""}`);
    const send = (code, body = "", headers = {}) => {
      res.writeHead(code, { "Docker-Distribution-Api-Version": "registry/2.0", "Content-Length": Buffer.byteLength(body), ...headers });
      res.end(req.method === "HEAD" ? undefined : body);
    };
    if (req.method !== "GET" && req.method !== "HEAD") return send(405, "{}");
    const url = (req.url || "").split("?")[0];
    if (url === "/v2/" || url === "/v2") return send(200, "{}", { "Content-Type": "application/json" });
    const prefix = `/v2/${LOOPBACK_REPOSITORY}/`;
    if (!url.startsWith(prefix)) return send(404, '{"errors":[{"code":"NAME_UNKNOWN"}]}');
    const [kind, ref, extra] = url.slice(prefix.length).split("/");
    if (extra !== undefined || !["manifests", "blobs"].includes(kind) || !DIGEST_RE.test(ref || "")) return send(404, '{"errors":[{"code":"MANIFEST_UNKNOWN"}]}');
    const file = path.join(blobs, ref.slice(7));
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      return send(404, '{"errors":[{"code":"BLOB_UNKNOWN"}]}');
    }
    let type = "application/octet-stream";
    if (kind === "manifests") {
      try {
        type = JSON.parse(fs.readFileSync(file, "utf8")).mediaType || "application/vnd.oci.image.manifest.v1+json";
      } catch {
        return send(404, '{"errors":[{"code":"MANIFEST_UNKNOWN"}]}');
      }
    }
    res.writeHead(200, { "Docker-Distribution-Api-Version": "registry/2.0", "Content-Type": type, "Content-Length": st.size, "Docker-Content-Digest": ref });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const host = `127.0.0.1:${server.address().port}`;
      resolve({
        host,
        reference: (digest) => `${host}/${LOOPBACK_REPOSITORY}@${digest}`,
        requests,
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); })
      });
    });
  });
}
