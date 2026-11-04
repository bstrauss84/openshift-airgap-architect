/**
 * Verified catalog fetch (v2.2.0 M7): OAA fetches operator catalogs over verified TLS itself and
 * oc-mirror lists only the digest-pinned loopback copy, without credentials.
 *
 * Disposable certificates and Node HTTPS registries only (helpers/tlsRegistryFixture.js).
 * The same flow against the exact oc-mirror binary is in
 * test-integration/verified-catalog-exact-binary.test.js (`npm run test:exact-binary`).
 */
import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fetchVerifiedImage, RegistryError, credentialsFor, parseChallenge, registryCoordinates } from "../src/verifiedRegistry.js";
import { registryTrustFor } from "../src/registryTrust.js";
import { describeTrust } from "../src/ocMirrorPreflightItems.js";
import { serveLayout } from "../src/loopbackRegistry.js";
import { openVerifiedCatalog, loopbackListEnv, loopbackCatalogArgs } from "../src/verifiedCatalog.js";
import { makeCertificates, buildCatalogImage, demoCatalog, startRegistry, startBlobCdn, startConnectProxy } from "./helpers/tlsRegistryFixture.js";

const PROXY_VARS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy", "ALL_PROXY", "all_proxy"];
let certs;
let scratch;
const saved = {};
const env = (extra = {}) => ({ PATH: process.env.PATH, HOME: scratch, SSL_CERT_FILE: certs.caFile, SSL_CERT_DIR: path.join(scratch, "no-cert-dir"), ...extra });
const authFile = (host, user = "qa", pass = "synthetic") => {
  const f = path.join(scratch, `auth-${crypto.randomBytes(3).toString("hex")}.json`);
  fs.writeFileSync(f, JSON.stringify({ auths: { [host]: { auth: Buffer.from(`${user}:${pass}`).toString("base64") } } }));
  return f;
};
const fetchOpts = (extra = {}) => ({ cacheRoot: path.join(scratch, "cache"), env: env(), retryDelayMs: 5, ...extra });
const rejectsCode = async (p, code) => {
  await assert.rejects(p, (err) => {
    assert.ok(err instanceof RegistryError, String(err));
    assert.equal(err.code, code, err.message);
    return true;
  });
};

before(() => {
  certs = makeCertificates();
  for (const k of PROXY_VARS) { saved[k] = process.env[k]; delete process.env[k]; }
});
after(() => {
  certs.cleanup();
  for (const k of PROXY_VARS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});
beforeEach(() => { scratch = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-vcat-")); });
afterEach(() => fs.rmSync(scratch, { recursive: true, force: true }));

describe("trust", () => {
  test("SSL_CERT_FILE replaces the default bundle list, like Go", () => {
    const t = registryTrustFor("127.0.0.1:1", { env: env() });
    assert.equal(t.systemFile, certs.caFile);
    assert.equal(t.ca.length, 1);
  });
  test("a certs.d CA for the host is added (containers/image)", () => {
    const d = path.join(scratch, ".config/containers/certs.d/127.0.0.1:5999");
    fs.mkdirSync(d, { recursive: true });
    fs.copyFileSync(certs.caFile, path.join(d, "ca.crt"));
    const t = registryTrustFor("127.0.0.1:5999", { env: env({ SSL_CERT_FILE: path.join(scratch, "none.pem") }) });
    assert.deepEqual(t.sources, [path.join(d, "ca.crt")]);
  });
});

describe("preflight trust text says what is actually trusted", () => {
  test("no CA variables: system bundle and certs.d", () => {
    const it = describeTrust({});
    assert.equal(it.status, "info");
    assert.match(it.detail, /Architect's own catalog downloads/);
    assert.match(it.detail, /certs\.d/);
  });
  test("SSL_CERT_FILE alone replaces the bundle file but not the default directories (Go)", () => {
    const it = describeTrust({ SSL_CERT_FILE: certs.caFile });
    assert.equal(it.status, "pass");
    assert.match(it.detail, /in place of the system bundle file/);
    assert.match(it.detail, /every certificate in \/etc\/ssl\/certs and \/etc\/pki\/tls\/certs/);
  });
  test("a configured CA file that does not exist blocks", () => {
    assert.equal(describeTrust({ SSL_CERT_FILE: "/nonexistent/ca.pem" }).status, "block");
  });
});

describe("verified fetch", () => {
  test("trusted registry: an OCI layout whose every byte matches its digest", async () => {
    const image = buildCatalogImage(demoCatalog());
    const reg = await startRegistry({ tls: certs.trusted, image });
    try {
      const r = await fetchVerifiedImage(reg.reference, fetchOpts());
      assert.equal(r.resolvedDigest, image.manifestDigest);
      assert.equal(r.manifestDigest, image.manifestDigest);
      for (const [digest, bytes] of [...image.blobs, [image.manifestDigest, image.manifest]]) {
        const onDisk = fs.readFileSync(path.join(r.layoutDir, "blobs/sha256", digest.slice(7)));
        assert.ok(onDisk.equals(bytes), digest);
      }
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(r.layoutDir, "index.json"), "utf8")).manifests[0].digest, image.manifestDigest);
    } finally { await reg.close(); }
  });

  test("untrusted certificate: refused before any HTTP request, so credentials never leave", async () => {
    const image = buildCatalogImage(demoCatalog());
    const reg = await startRegistry({ tls: certs.attacker, image, basicAuth: { user: "qa", pass: "synthetic" } });
    try {
      await rejectsCode(fetchVerifiedImage(reg.reference, fetchOpts({ authFile: authFile(reg.host) })), "TLS_UNTRUSTED");
      assert.deepEqual(reg.requests, [], "no request may reach a server whose certificate failed");
    } finally { await reg.close(); }
  });

  test("the same untrusted server is refused even with a CA bundle that trusts something else", async () => {
    const image = buildCatalogImage(demoCatalog());
    const reg = await startRegistry({ tls: certs.attacker, image });
    try {
      await assert.rejects(fetchVerifiedImage(reg.reference, fetchOpts()), /could not be verified/);
    } finally { await reg.close(); }
  });

  test("basic auth from the pull secret", async () => {
    const image = buildCatalogImage(demoCatalog());
    const reg = await startRegistry({ tls: certs.trusted, image, basicAuth: { user: "qa", pass: "synthetic" } });
    try {
      await rejectsCode(fetchVerifiedImage(reg.reference, fetchOpts()), "AUTH_REQUIRED");
      await rejectsCode(fetchVerifiedImage(reg.reference, fetchOpts({ authFile: authFile(reg.host, "qa", "wrong") })), "AUTH_DENIED");
      const ok = await fetchVerifiedImage(reg.reference, fetchOpts({ authFile: authFile(reg.host) }));
      assert.equal(ok.resolvedDigest, image.manifestDigest);
    } finally { await reg.close(); }
  });

  test("token auth; blobs redirected to a CDN receive no credentials", async () => {
    const image = buildCatalogImage(demoCatalog());
    const cdn = await startBlobCdn({ tls: certs.trusted, image });
    const reg = await startRegistry({ tls: certs.trusted, image, tokenAuth: { user: "qa", pass: "synthetic" }, blobRedirectBase: cdn.base });
    try {
      const r = await fetchVerifiedImage(reg.reference, fetchOpts({ authFile: authFile(reg.host) }));
      assert.equal(r.manifestDigest, image.manifestDigest);
      assert.ok(reg.requests.some((q) => q.url.startsWith("/token") && q.authorization === "Basic"));
      assert.ok(reg.requests.some((q) => q.authorization === "Bearer"));
      assert.equal(cdn.requests.length, image.blobs.size);
      assert.ok(cdn.requests.every((q) => q.authorization === null), "credentials crossed to the CDN");
    } finally { await reg.close(); await cdn.close(); }
  });

  test("a tampered blob is an integrity failure, not data", async () => {
    const image = buildCatalogImage(demoCatalog());
    const [layerDigest] = [...image.blobs.keys()];
    const original = image.blobs.get(layerDigest);
    image.blobs.set(layerDigest, Buffer.concat([original.subarray(0, original.length - 1), Buffer.from([original[original.length - 1] ^ 0xff])]));
    const reg = await startRegistry({ tls: certs.trusted, image });
    try {
      await rejectsCode(fetchVerifiedImage(reg.reference, fetchOpts()), "INTEGRITY");
      assert.equal(fs.readdirSync(path.join(scratch, "cache"), { recursive: true }).filter((f) => String(f).includes(layerDigest.slice(7, 19))).length, 0);
    } finally { await reg.close(); }
  });

  test("a by-digest reference whose served manifest differs is refused", async () => {
    const image = buildCatalogImage(demoCatalog());
    const other = buildCatalogImage(demoCatalog("other-op"));
    const reg = await startRegistry({ tls: certs.trusted, image, fault: (req) => (req.url.includes(`manifests/${image.manifestDigest}`) ? { status: 200, body: other.manifest } : null) });
    try {
      await rejectsCode(fetchVerifiedImage(`${reg.host}/redhat/demo-index@${image.manifestDigest}`, fetchOpts()), "INTEGRITY");
    } finally { await reg.close(); }
  });

  test("transient failures are retried a bounded number of times; refusals are not", async () => {
    const image = buildCatalogImage(demoCatalog());
    let failures = 2;
    const reg = await startRegistry({ tls: certs.trusted, image, fault: (req) => (req.url.includes("/blobs/") && failures-- > 0 ? { status: 503 } : null) });
    try {
      const r = await fetchVerifiedImage(reg.reference, fetchOpts());
      assert.equal(r.manifestDigest, image.manifestDigest);
    } finally { await reg.close(); }
    const reg2 = await startRegistry({ tls: certs.trusted, image, fault: (req) => (req.url.includes("/blobs/") ? { status: 503 } : null) });
    try {
      await rejectsCode(fetchVerifiedImage(reg2.reference, fetchOpts({ retries: 2 })), "TRANSIENT");
      assert.equal(reg2.requests.filter((q) => q.url.includes("/blobs/")).length, 3, "1 try + 2 retries, then stop");
    } finally { await reg2.close(); }
    const reg3 = await startRegistry({ tls: certs.trusted, image, basicAuth: { user: "qa", pass: "synthetic" } });
    try {
      await rejectsCode(fetchVerifiedImage(reg3.reference, fetchOpts({ authFile: authFile(reg3.host, "qa", "wrong") })), "AUTH_DENIED");
      assert.equal(reg3.requests.filter((q) => q.url.includes("/manifests/")).length, 2, "one challenge, one refused attempt, no retries");
    } finally { await reg3.close(); }
  });

  test("a multi-arch index resolves to its digest and the platform manifest is listed", async () => {
    const image = buildCatalogImage(demoCatalog(), { withIndex: true });
    const reg = await startRegistry({ tls: certs.trusted, image });
    try {
      const r = await fetchVerifiedImage(reg.reference, fetchOpts({ arch: "amd64" }));
      assert.equal(r.resolvedDigest, image.indexDigest);
      assert.equal(r.manifestDigest, image.manifestDigest);
      await rejectsCode(fetchVerifiedImage(reg.reference, fetchOpts({ arch: "s390x" })), "UNSUPPORTED");
    } finally { await reg.close(); }
  });

  test("through an HTTPS_PROXY tunnel the target certificate is still verified", async () => {
    const image = buildCatalogImage(demoCatalog());
    const proxy = await startConnectProxy();
    const good = await startRegistry({ tls: certs.trusted, image });
    const bad = await startRegistry({ tls: certs.attacker, image });
    process.env.HTTPS_PROXY = proxy.url;
    try {
      const r = await fetchVerifiedImage(good.reference, fetchOpts());
      assert.equal(r.manifestDigest, image.manifestDigest);
      assert.ok(proxy.connects.includes(good.host), "went through the proxy");
      await rejectsCode(fetchVerifiedImage(bad.reference, fetchOpts()), "TLS_UNTRUSTED");
      assert.ok(proxy.connects.includes(bad.host));
      assert.deepEqual(bad.requests, []);
    } finally {
      delete process.env.HTTPS_PROXY;
      await good.close(); await bad.close(); await proxy.close();
    }
  });

  test("helpers: challenge parsing, credentials lookup, Docker Hub coordinates", () => {
    assert.deepEqual(parseChallenge('Bearer realm="https://a/token",service="s",scope="repository:x:pull"'), { scheme: "bearer", params: { realm: "https://a/token", service: "s", scope: "repository:x:pull" } });
    const f = authFile("registry.redhat.io");
    assert.equal(credentialsFor(f, ["registry.redhat.io"]), Buffer.from("qa:synthetic").toString("base64"));
    assert.equal(credentialsFor(f, ["quay.io"]), null);
    assert.equal(registryCoordinates("busybox:1").repository, "library/busybox");
    assert.equal(registryCoordinates("busybox:1").host, "registry-1.docker.io");
    const legacy = path.join(scratch, "legacy-hub.json");
    fs.writeFileSync(legacy, JSON.stringify({ auths: { "https://index.docker.io/v1/": { auth: "aHViOnVzZXI=" } } }));
    assert.equal(credentialsFor(legacy, registryCoordinates("busybox:1").authHosts), "aHViOnVzZXI=", "legacy Docker Hub key still found");
  });
});

describe("loopback registry", () => {
  test("serves by digest only, read-only, and records whether credentials arrive", async () => {
    const image = buildCatalogImage(demoCatalog());
    const reg = await startRegistry({ tls: certs.trusted, image });
    let srv;
    try {
      const r = await fetchVerifiedImage(reg.reference, fetchOpts());
      srv = await serveLayout(r.layoutDir);
      const base = `http://${srv.host}/v2/oaa-verified/catalog`;
      assert.equal((await fetch(`http://${srv.host}/v2/`)).status, 200);
      const m = await fetch(`${base}/manifests/${image.manifestDigest}`);
      assert.equal(m.status, 200);
      assert.equal(m.headers.get("docker-content-digest"), image.manifestDigest);
      assert.equal((await fetch(`${base}/manifests/v1`)).status, 404, "tags are not served");
      assert.equal((await fetch(`http://${srv.host}/v2/other/repo/manifests/${image.manifestDigest}`)).status, 404);
      assert.equal((await fetch(`${base}/blobs/${image.manifestDigest}`, { method: "DELETE" })).status, 405);
      assert.equal((await fetch(`${base}/blobs/sha256:${"0".repeat(64)}`)).status, 404);
      assert.ok(srv.requests.every((q) => !q.includes("authorization")));
    } finally { await srv?.close(); await reg.close(); }
  });

  test("the oc-mirror child gets the loopback reference pinned by digest, an empty auth file, loopback never proxied", async () => {
    const args = loopbackCatalogArgs("127.0.0.1:4567/oaa-verified/catalog@sha256:" + "a".repeat(64), "/tmp/x/auth.json");
    assert.deepEqual(args, ["--catalog=127.0.0.1:4567/oaa-verified/catalog@sha256:" + "a".repeat(64), "--src-tls-verify=false", "--authfile=/tmp/x/auth.json"]);
    const image = buildCatalogImage(demoCatalog());
    const reg = await startRegistry({ tls: certs.trusted, image });
    try {
      const c = await openVerifiedCatalog(reg.reference, { dataDir: scratch, fetchOptions: { env: env(), retryDelayMs: 5 } });
      assert.deepEqual(JSON.parse(fs.readFileSync(c.emptyAuthFile, "utf8")), { auths: {} });
      await c.close();
      assert.equal(fs.existsSync(c.emptyAuthFile), false, "removed with the listing");
    } finally { await reg.close(); }
    const e = loopbackListEnv({ REGISTRY_AUTH_FILE: "/run/secrets/x", NO_PROXY: "10.0.0.0/8", HTTPS_PROXY: "http://p:3128" });
    assert.equal(e.REGISTRY_AUTH_FILE, undefined);
    assert.equal(e.NO_PROXY, "127.0.0.1,localhost,10.0.0.0/8");
    assert.equal(e.no_proxy, "127.0.0.1,localhost");
    assert.equal(e.HTTPS_PROXY, "http://p:3128");
  });
});
