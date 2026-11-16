/**
 * Disposable TLS registry fixtures for the verified-fetch tests (v2.2.0 M7).
 *
 * Everything is generated at test time (openssl) into a temp directory: a
 * throwaway CA, a server certificate it signs for 127.0.0.1/localhost, and an
 * unrelated self-signed "attacker" certificate for the same names. No key is
 * committed. Registries are Node HTTPS servers over an OCI layout built here,
 * recording every request (and whether it carried credentials).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";

const ssl = (args, cwd) => execFileSync("openssl", args, { cwd, stdio: ["ignore", "ignore", "pipe"] });

/** CA + CA-signed server cert + unrelated self-signed cert, all for 127.0.0.1 / localhost. */
export function makeCertificates() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-vcat-certs-"));
  fs.writeFileSync(path.join(dir, "san.ext"), "subjectAltName=IP:127.0.0.1,DNS:localhost\n");
  ssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=oaa-test-ca", "-keyout", "ca.key", "-out", "ca.crt"], dir);
  ssl(["req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=127.0.0.1", "-keyout", "server.key", "-out", "server.csr"], dir);
  ssl(["x509", "-req", "-in", "server.csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-days", "2", "-extfile", "san.ext", "-out", "server.crt"], dir);
  ssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost", "-keyout", "attacker.key", "-out", "attacker.crt"], dir);
  const read = (n) => fs.readFileSync(path.join(dir, n), "utf8");
  return {
    dir,
    caFile: path.join(dir, "ca.crt"),
    trusted: { cert: read("server.crt"), key: read("server.key") },
    attacker: { cert: read("attacker.crt"), key: read("attacker.key") },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true })
  };
}

// --- minimal OCI image builder ------------------------------------------------

const tarEntry = (name, data, type = "0") => {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100);
  h.write(type === "5" ? "0000755\0" : "0000644\0", 100);
  h.write("0000000\0", 108); h.write("0000000\0", 116);
  h.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124);
  h.write("00000000000\0", 136);
  h.write("        ", 148);
  h.write(type, 156);
  h.write("ustar\0", 257); h.write("00", 263);
  let sum = 0; for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([h, data, pad]);
};
const sha = (b) => `sha256:${crypto.createHash("sha256").update(b).digest("hex")}`;

/**
 * One-layer FBC catalog image. packages: { name: [fbc json objects] }.
 * @returns {{ blobs: Map<string, Buffer>, manifest: Buffer, manifestDigest: string, index: Buffer, indexDigest: string }}
 */
export function buildCatalogImage(packages, { arch = "amd64", withIndex = false } = {}) {
  const parts = [tarEntry("configs/", Buffer.alloc(0), "5")];
  for (const [pkg, objs] of Object.entries(packages)) {
    parts.push(tarEntry(`configs/${pkg}/`, Buffer.alloc(0), "5"));
    parts.push(tarEntry(`configs/${pkg}/catalog.json`, Buffer.from(objs.map((o) => JSON.stringify(o)).join("\n"))));
  }
  const raw = Buffer.concat([...parts, Buffer.alloc(1024)]);
  const layer = zlib.gzipSync(raw);
  const config = Buffer.from(JSON.stringify({ architecture: arch, os: "linux", config: { Labels: { "operators.operatorframework.io.index.configs.v1": "/configs" } }, rootfs: { type: "layers", diff_ids: [sha(raw)] } }));
  const manifest = Buffer.from(JSON.stringify({
    schemaVersion: 2, mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: sha(config), size: config.length },
    layers: [{ mediaType: "application/vnd.oci.image.layer.v1.tar+gzip", digest: sha(layer), size: layer.length }]
  }));
  const index = Buffer.from(JSON.stringify({
    schemaVersion: 2, mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [
      { mediaType: "application/vnd.oci.image.manifest.v1+json", digest: sha(manifest), size: manifest.length, platform: { os: "linux", architecture: arch } }
    ]
  }));
  const blobs = new Map([[sha(layer), layer], [sha(config), config]]);
  return { blobs, manifest, manifestDigest: sha(manifest), index, indexDigest: sha(index), withIndex };
}

/** A tiny FBC with one package and two channels. */
export const demoCatalog = (pkg = "demo-op") => ({
  [pkg]: [
    { schema: "olm.package", name: pkg, defaultChannel: "stable" },
    { schema: "olm.channel", name: "stable", package: pkg, entries: [{ name: `${pkg}.v1.0.0` }, { name: `${pkg}.v1.0.1`, replaces: `${pkg}.v1.0.0` }] },
    { schema: "olm.channel", name: "fast", package: pkg, entries: [{ name: `${pkg}.v1.1.0` }] },
    ...["1.0.0", "1.0.1", "1.1.0"].map((v) => ({ schema: "olm.bundle", name: `${pkg}.v${v}`, package: pkg, image: `example.invalid/${pkg}-bundle:v${v}`, properties: [{ type: "olm.package", value: { packageName: pkg, version: v } }] }))
  ]
});

// --- HTTPS registry --------------------------------------------------------------

/**
 * @param {object} o
 * @param {{cert,key}} o.tls
 * @param {object} o.image buildCatalogImage() result
 * @param {string} [o.repository]
 * @param {string} [o.tag]
 * @param {{user:string, pass:string}} [o.basicAuth]  require Basic credentials on /v2/
 * @param {{user:string, pass:string}} [o.tokenAuth]  Bearer flow via /token on this server
 * @param {string} [o.blobRedirectBase]  302 blob GETs to <base>/blobs/<digest>
 * @param {(req)=>({status?:number, body?:Buffer, destroy?:boolean}|null)} [o.fault]
 */
export function startRegistry({ tls, image, repository = "redhat/demo-index", tag = "v1", basicAuth = null, tokenAuth = null, blobRedirectBase = null, fault = null }) {
  const requests = [];
  const token = crypto.randomBytes(12).toString("hex");
  const top = image.withIndex ? image.index : image.manifest;
  const topDigest = image.withIndex ? image.indexDigest : image.manifestDigest;
  const manifests = new Map([[image.manifestDigest, image.manifest], ...(image.withIndex ? [[image.indexDigest, image.index]] : [])]);
  const basicOk = (h, cred) => h === `Basic ${Buffer.from(`${cred.user}:${cred.pass}`).toString("base64")}`;
  const server = https.createServer({ ...tls }, (req, res) => {
    const auth = req.headers.authorization || "";
    requests.push({ method: req.method, url: req.url, authorization: auth ? auth.split(" ")[0] : null });
    const f = fault?.(req);
    if (f?.destroy) return req.socket.destroy();
    if (f) { res.writeHead(f.status || 500); return res.end(f.body || ""); }
    const url = new URL(req.url, "https://x");
    if (url.pathname === "/token") {
      if (!tokenAuth || !basicOk(auth, tokenAuth)) { res.writeHead(401); return res.end(); }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ token }));
    }
    if (tokenAuth && auth !== `Bearer ${token}`) {
      const { port } = server.address();
      res.writeHead(401, { "WWW-Authenticate": `Bearer realm="https://127.0.0.1:${port}/token",service="test",scope="repository:${repository}:pull"` });
      return res.end();
    }
    if (basicAuth && !basicOk(auth, basicAuth)) { res.writeHead(401, { "WWW-Authenticate": 'Basic realm="test"' }); return res.end(); }
    if (url.pathname === "/v2/") { res.writeHead(200); return res.end("{}"); }
    const prefix = `/v2/${repository}/`;
    if (!url.pathname.startsWith(prefix)) { res.writeHead(404); return res.end(); }
    const [kind, ref] = url.pathname.slice(prefix.length).split("/");
    if (kind === "manifests") {
      const body = ref === tag ? top : manifests.get(ref);
      if (!body) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": JSON.parse(body).mediaType, "Docker-Content-Digest": ref === tag ? topDigest : ref, "Content-Length": body.length });
      return res.end(body);
    }
    if (kind === "blobs") {
      const blob = image.blobs.get(ref);
      if (!blob) { res.writeHead(404); return res.end(); }
      if (blobRedirectBase) { res.writeHead(302, { Location: `${blobRedirectBase}/blobs/${ref}?sig=signed` }); return res.end(); }
      res.writeHead(200, { "Content-Length": blob.length });
      return res.end(blob);
    }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const host = `127.0.0.1:${server.address().port}`;
    resolve({ host, reference: `${host}/${repository}:${tag}`, topDigest, requests, close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) });
  }));
}

/** A "CDN": serves blobs by digest, records whether credentials arrived. */
export function startBlobCdn({ tls, image }) {
  const requests = [];
  const server = https.createServer({ ...tls }, (req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization || null });
    const ref = new URL(req.url, "https://x").pathname.split("/").pop();
    const blob = image.blobs.get(ref);
    if (!blob) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Length": blob.length });
    res.end(blob);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ base: `https://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) })));
}

/** Plain HTTP CONNECT proxy; records each CONNECT target. */
export function startConnectProxy() {
  const connects = [];
  const server = http.createServer((_req, res) => { res.writeHead(405); res.end(); });
  server.on("connect", (req, client, head) => {
    connects.push(req.url);
    const [host, port] = req.url.split(":");
    const upstream = net.connect(Number(port), host, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head?.length) upstream.write(head);
      upstream.pipe(client); client.pipe(upstream);
    });
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, connects, close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) })));
}
