/**
 * Why a catalog scan failed — said truthfully (v2.2.0, Scan Operators P0).
 *
 * Reported: Scan Operators "fails immediately, even with a pull secret". The
 * owner's backend sent all HTTPS through a proxy that refused connections; the
 * verified fetch failed in milliseconds, before any credential was sent and
 * before oc-mirror started, and the job said "registry.redhat.io could not be
 * reached (ECONNREFUSED)" — naming the registry, which was never contacted.
 *
 * These tests use real TLS fixture registries, a real refused port and the
 * production catalog resolver. Credentials are synthetic.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fetchVerifiedImage, RegistryError, configuredHttpsProxy } from "../src/verifiedRegistry.js";
import { openVerifiedCatalog } from "../src/verifiedCatalog.js";
import { runScanJob } from "../src/operators.js";
import { getJob, writeTempAuth } from "../src/utils.js";
import { isTerminalJobStatus } from "../src/jobStatus.js";
import { makeCertificates, buildCatalogImage, demoCatalog, startRegistry } from "./helpers/tlsRegistryFixture.js";

const PROXY_VARS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy", "ALL_PROXY", "all_proxy"];
const saved = {};
let certs;
let scratch;
const env = () => ({ PATH: process.env.PATH, HOME: scratch, SSL_CERT_FILE: certs.caFile, SSL_CERT_DIR: path.join(scratch, "no-cert-dir"), ...Object.fromEntries(PROXY_VARS.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])) });
const fetchOpts = () => ({ cacheRoot: path.join(scratch, "cache"), env: env(), retryDelayMs: 5 });

/** A loopback port with nothing listening on it. */
const closedPort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

const unreachable = async (p) => {
  let caught;
  await assert.rejects(p, (err) => { caught = err; return err instanceof RegistryError && err.code === "UNREACHABLE"; });
  return caught.message;
};

before(() => {
  certs = makeCertificates();
  for (const k of PROXY_VARS) { saved[k] = process.env[k]; delete process.env[k]; }
});
after(() => {
  certs.cleanup();
  for (const k of PROXY_VARS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});
beforeEach(() => { scratch = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-scan-reason-")); });
afterEach(() => {
  for (const k of PROXY_VARS) delete process.env[k];
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe("a refused proxy is named as the proxy, not as the registry", () => {
  test("HTTPS_PROXY refuses: message names the proxy; the registry gets no request", async () => {
    const registry = await startRegistry({ tls: certs.trusted, image: buildCatalogImage(demoCatalog()) });
    const port = await closedPort();
    process.env.HTTPS_PROXY = `http://127.0.0.1:${port}`;
    try {
      const msg = await unreachable(fetchVerifiedImage(registry.reference, fetchOpts()));
      assert.match(msg, new RegExp(`HTTPS proxy 127\\.0\\.0\\.1:${port}`));
      assert.match(msg, /ECONNREFUSED/);
      assert.match(msg, new RegExp(`${registry.host.replace(/[.]/g, "\\.")} was not contacted and no credential was sent`));
      assert.match(msg, /HTTPS_PROXY \/ NO_PROXY/);
      assert.deepEqual(registry.requests, []);
    } finally {
      await registry.close();
    }
  });

  test("a proxy given by name (localhost) is still recognised", async () => {
    const port = await closedPort();
    process.env.https_proxy = `http://localhost:${port}`;
    const msg = await unreachable(fetchVerifiedImage("registry.example.test/redhat/redhat-operator-index:v4.22", fetchOpts()));
    assert.match(msg, new RegExp(`HTTPS proxy localhost:${port}`));
    assert.doesNotMatch(msg, /^registry\.example\.test could not be reached/);
  });

  test("proxy credentials never appear in the message", async () => {
    const port = await closedPort();
    process.env.HTTPS_PROXY = `http://proxyuser:pr0xy-s3cret@127.0.0.1:${port}`;
    const msg = await unreachable(fetchVerifiedImage("registry.example.test/redhat/redhat-operator-index:v4.22", fetchOpts()));
    assert.doesNotMatch(msg, /proxyuser|pr0xy-s3cret/);
    assert.deepEqual(configuredHttpsProxy({ HTTPS_PROXY: `http://proxyuser:pr0xy-s3cret@127.0.0.1:${port}` }), { host: "127.0.0.1", port });
  });

  test("no proxy: the registry itself is named, with a hint about HTTPS_PROXY", async () => {
    const port = await closedPort();
    const msg = await unreachable(fetchVerifiedImage(`127.0.0.1:${port}/redhat/redhat-operator-index:v4.22`, fetchOpts()));
    assert.match(msg, new RegExp(`^127\\.0\\.0\\.1:${port} could not be reached \\(ECONNREFUSED\\)`));
    assert.doesNotMatch(msg, /HTTPS proxy/);
  });

  test("NO_PROXY bypass: a refused registry is the registry's failure even with a proxy set", async () => {
    const port = await closedPort();
    const proxyPort = await closedPort();
    process.env.HTTPS_PROXY = `http://127.0.0.1:${proxyPort}`;
    process.env.NO_PROXY = "127.0.0.1";
    const msg = await unreachable(fetchVerifiedImage(`127.0.0.1:${port}/redhat/redhat-operator-index:v4.22`, fetchOpts()));
    assert.match(msg, new RegExp(`^127\\.0\\.0\\.1:${port} could not be reached`));
    assert.match(msg, new RegExp(`HTTPS_PROXY 127\\.0\\.0\\.1:${proxyPort}, NO_PROXY`));
  });
});

describe("no credentials is not 'refused the credentials' (owner's Live catalog check, 2026-11-03)", () => {
  test("a token service that refuses anonymous access: AUTH_REQUIRED, saying none were given", async () => {
    const reg = await startRegistry({ tls: certs.trusted, image: buildCatalogImage(demoCatalog()), tokenAuth: { user: "qa", pass: "synthetic" } });
    try {
      let caught;
      await assert.rejects(fetchVerifiedImage(reg.reference, fetchOpts()), (err) => { caught = err; return err.code === "AUTH_REQUIRED"; });
      assert.match(caught.message, /requires credentials; none were given for it/);
      assert.doesNotMatch(caught.message, /refused the credentials/);
      const { classifyFetchFailure, judgeOperator } = await import("../src/operatorPackageLookup.js");
      const verdict = judgeOperator({ name: "cli-manager", defaultChannel: "tech-preview", catalogImage: reg.reference }, { failure: classifyFetchFailure(caught) });
      assert.equal(verdict.status, "unverified");
      assert.match(verdict.message, /needs credentials and none were given/);
    } finally { await reg.close(); }
  });
});

describe("the scan job carries the reason and stops before oc-mirror", () => {
  test("refused proxy: the job fails with the proxy reason, oc-mirror never starts, the pull secret is released", async () => {
    const port = await closedPort();
    process.env.HTTPS_PROXY = `http://127.0.0.1:${port}`;
    const marker = path.join(scratch, "oc-mirror-started");
    const bin = path.join(scratch, "oc-mirror");
    fs.writeFileSync(bin, `#!/bin/sh\n: > "${marker}"\n`, { mode: 0o755 });
    const authFile = writeTempAuth(JSON.stringify({ auths: { "registry.redhat.io": { auth: Buffer.from("qa:synthetic").toString("base64") } } }));
    const jobId = runScanJob({
      version: "4.22", catalogId: "redhat", catalogImage: "registry.redhat.io/redhat/redhat-operator-index:v4.22",
      authFile, ocMirrorPath: bin,
      catalogResolver: (image, opts) => openVerifiedCatalog(image, { ...opts, dataDir: scratch, fetchOptions: { env: env(), retryDelayMs: 5 } })
    });
    const deadline = Date.now() + 15000;
    let job;
    while (!(job = getJob(jobId)) || !isTerminalJobStatus(job.status)) {
      if (Date.now() > deadline) throw new Error("scan did not settle");
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(job.status, "failed");
    assert.match(job.message, /^The redhat catalog could not be fetched and verified: The HTTPS proxy 127\.0\.0\.1:\d+ configured for the Architect backend could not be reached \(ECONNREFUSED\), so registry\.redhat\.io was not contacted/);
    const failure = JSON.parse(job.metadata_json).failure;
    assert.equal(failure.code, "UNREACHABLE");
    assert.match(failure.reason, /^The HTTPS proxy 127\.0\.0\.1:\d+ /, "the reason on its own, for the UI");
    assert.equal(fs.existsSync(marker), false, "oc-mirror must not start");
    assert.equal(fs.existsSync(authFile), false, "the temporary pull secret is removed");
  });
});
