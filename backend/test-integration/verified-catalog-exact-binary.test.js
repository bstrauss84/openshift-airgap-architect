/**
 * Verified catalog fetch with the EXACT oc-mirror binary (v2.2.0 M7). Not part of `npm test`:
 * run `OAA_TEST_OC_MIRROR_BIN=/path/to/oc-mirror npm run test:exact-binary`.
 * Fails (does not skip) when the binary is not given, so it can never pass
 * without having run.
 */
import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openVerifiedCatalog } from "../src/verifiedCatalog.js";
import { makeCertificates, buildCatalogImage, demoCatalog, startRegistry } from "../test/helpers/tlsRegistryFixture.js";

const OCM = process.env.OAA_TEST_OC_MIRROR_BIN;
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

before(() => {
  assert.ok(OCM && fs.existsSync(OCM), "OAA_TEST_OC_MIRROR_BIN must name the oc-mirror binary for this suite");
  certs = makeCertificates();
  for (const k of PROXY_VARS) { saved[k] = process.env[k]; delete process.env[k]; }
});
after(() => {
  certs?.cleanup();
  for (const k of PROXY_VARS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});
beforeEach(() => { scratch = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-vcat-exact-")); });
afterEach(() => fs.rmSync(scratch, { recursive: true, force: true }));

describe("exact oc-mirror binary", () => {
  test("scan path: verified fetch, then oc-mirror lists the loopback copy offline and without credentials", async () => {
    const { runScanJob, getResults } = await import("../src/operators.js");
    const { getJob } = await import("../src/utils.js");
    const image = buildCatalogImage(demoCatalog());
    const reg = await startRegistry({ tls: certs.trusted, image, tokenAuth: { user: "qa", pass: "synthetic" } });
    const savedCert = process.env.SSL_CERT_FILE;
    process.env.SSL_CERT_FILE = certs.caFile;
    try {
      const minor = `9.${crypto.randomInt(1000, 9999)}`;
      const jobId = runScanJob({
        version: minor, catalogId: "redhat", catalogImage: reg.reference, ocMirrorPath: OCM,
        authFile: authFile(reg.host),
        catalogResolver: (img, o) => openVerifiedCatalog(img, { ...o, dataDir: scratch, fetchOptions: { env: env(), retryDelayMs: 5 } })
      });
      let job;
      for (let i = 0; i < 600; i++) { job = getJob(jobId); if (["completed", "failed", "cancelled"].includes(job.status)) break; await new Promise((r) => setTimeout(r, 100)); }
      assert.equal(job.status, "completed", `${job.message}\n${job.output}`);
      const stored = getResults(minor, "redhat");
      assert.deepEqual(stored.results.map((r) => r.name), ["demo-op"]);
      assert.equal(stored.catalogIdentity.resolvedDigest, image.manifestDigest);
      assert.equal(stored.catalogIdentity.sourceReference, reg.reference);
    } finally {
      if (savedCert === undefined) delete process.env.SSL_CERT_FILE; else process.env.SSL_CERT_FILE = savedCert;
      await reg.close();
    }
  });

  test("scan path fails closed on an untrusted registry and never starts oc-mirror", async () => {
    const { runScanJob } = await import("../src/operators.js");
    const { getJob } = await import("../src/utils.js");
    const marker = path.join(scratch, "spawned");
    const fakeBin = path.join(scratch, "oc-mirror-should-not-run");
    fs.writeFileSync(fakeBin, `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });
    const image = buildCatalogImage(demoCatalog());
    const reg = await startRegistry({ tls: certs.attacker, image });
    try {
      const jobId = runScanJob({
        version: "9.0", catalogId: "redhat", catalogImage: reg.reference, ocMirrorPath: fakeBin,
        catalogResolver: (img, o) => openVerifiedCatalog(img, { ...o, dataDir: scratch, fetchOptions: { env: env(), retryDelayMs: 5 } })
      });
      let job;
      for (let i = 0; i < 300; i++) { job = getJob(jobId); if (["completed", "failed", "cancelled"].includes(job.status)) break; await new Promise((r) => setTimeout(r, 50)); }
      assert.equal(job.status, "failed");
      assert.match(job.message, /could not be verified/);
      assert.equal(fs.existsSync(marker), false, "oc-mirror must not run when the catalog could not be verified");
      assert.deepEqual(reg.requests, []);
    } finally { await reg.close(); }
  });
});
