/**
 * v2.2.0 stabilization — Mirroring catalog scans: one explicit source credential
 * contract (FQ-SCAN-1), the failure kept in the job (FQ-SCAN-4), and each catalog
 * job listed in Mirroring Operations.
 *
 * Through the real HTTP API. The verified catalog fetch is replaced by a test
 * opener (covered by verified-catalog-fetch.test.js and
 * scan-failure-reason.test.js); oc-mirror by a stub that prints a listing.
 * Credentials are synthetic.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { app } from "../src/index.js";
import { setCatalogOpenerForTests } from "../src/verifiedCatalog.js";
import { RegistryError } from "../src/verifiedRegistry.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

const SECRET_B64 = Buffer.from("scan-user:scan-canary-9f3").toString("base64");
const SECRET = JSON.stringify({ auths: { "registry.redhat.io": { auth: SECRET_B64 } } });
let server;
let baseUrl;
let scratch;
const opened = []; // { image, authFile, authFileContents }
const failCatalogs = new Set();
const savedEnv = { OC_MIRROR_BIN: process.env.OC_MIRROR_BIN, REGISTRY_AUTH_FILE: process.env.REGISTRY_AUTH_FILE };

const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
};
const terminal = async (jobId) => {
  const deadline = Date.now() + 15000;
  for (;;) {
    const job = (await api("GET", `/api/jobs/${jobId}`)).json;
    if (job && ["completed", "failed", "cancelled", "completed_with_warnings"].includes(job.status)) return job;
    if (Date.now() > deadline) throw new Error(`job ${jobId} did not settle`);
    await new Promise((r) => setTimeout(r, 20));
  }
};

before(async () => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-scan-ops-"));
  const bin = path.join(scratch, "oc-mirror");
  fs.writeFileSync(bin, [
    "#!/bin/sh",
    'case "$*" in *version*) echo "oc-mirror stub 0.0.0"; exit 0 ;; esac',
    'echo "NAME                DISPLAY NAME           DEFAULT CHANNEL"',
    'echo "alpha-operator      Alpha Operator         stable"',
    'echo "beta-operator       Beta Operator          fast"'
  ].join("\n") + "\n", { mode: 0o755 });
  process.env.OC_MIRROR_BIN = bin;
  // A mounted Install scan credential that a Mirroring scan must never pick up.
  const ambient = path.join(scratch, "registry-auth-file.json");
  fs.writeFileSync(ambient, JSON.stringify({ auths: { "registry.redhat.io": { auth: Buffer.from("ambient:must-not-be-used").toString("base64") } } }));
  process.env.REGISTRY_AUTH_FILE = ambient;
  setCatalogOpenerForTests(async (image, opts) => {
    opened.push({ image, authFile: opts.authFile, authFileContents: opts.authFile && fs.existsSync(opts.authFile) ? fs.readFileSync(opts.authFile, "utf8") : null });
    const id = image.includes("certified") ? "certified" : image.includes("community") ? "community" : "redhat";
    if (failCatalogs.has(id)) throw new RegistryError("AUTH_DENIED", "registry.redhat.io denied access to redhat/certified-operator-index (403).");
    return { localReference: image, resolvedDigest: `sha256:${"a".repeat(64)}`, manifestDigest: `sha256:${"a".repeat(64)}`, fetchedAt: Date.now(), close: async () => {} };
  });
  ({ server, baseUrl } = await createTestServer(app));
});
after(async () => {
  await closeTestServer(server);
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  fs.rmSync(scratch, { recursive: true, force: true });
});

const newProfile = async () => {
  const r = await api("POST", "/api/mirroring/profiles", { name: `scan ${Date.now()}`, content: { operators: true }, operators: { catalogMinor: "4.22" } });
  assert.equal(r.status, 201, r.text);
  return r.json;
};

describe("FQ-SCAN-1: Mirroring scans name their source credential; no fallback", () => {
  test("inline without a pull secret is refused, even with REGISTRY_AUTH_FILE mounted", async () => {
    const p = await newProfile();
    const r = await api("POST", "/api/operators/scan", { catalogMinor: "4.22", profileId: p.id, rhAuthSource: "inline" });
    assert.equal(r.status, 400);
    assert.equal(r.json.code, "REGISTRY_AUTH_MISSING");
  });

  test("mounted without a mounted Red Hat pull secret is refused (REGISTRY_AUTH_FILE is not it)", async () => {
    const p = await newProfile();
    const r = await api("POST", "/api/operators/scan", { catalogMinor: "4.22", profileId: p.id, rhAuthSource: "mounted" });
    assert.equal(r.status, 400);
    assert.equal(r.json.code, "REGISTRY_AUTH_MISSING");
    assert.match(r.json.error, /No Red Hat pull secret is mounted/);
  });

  test("invalid JSON, a credential choice without a catalog minor, an unknown profile and 4.23 are refused before anything is written", async () => {
    const p = await newProfile();
    const before = opened.length;
    assert.equal((await api("POST", "/api/operators/scan", { catalogMinor: "4.22", profileId: p.id, rhAuthSource: "inline", pullSecret: "not json" })).status, 400);
    assert.equal((await api("POST", "/api/operators/scan", { rhAuthSource: "inline", pullSecret: SECRET })).status, 400);
    assert.equal((await api("POST", "/api/operators/scan", { catalogMinor: "4.22", profileId: "p-doesnotexist", rhAuthSource: "inline", pullSecret: SECRET })).status, 404);
    const v423 = await api("POST", "/api/operators/scan", { catalogMinor: "4.23", profileId: p.id, rhAuthSource: "inline", pullSecret: SECRET });
    assert.equal(v423.status, 422);
    assert.equal(v423.json.code, "UNSUPPORTED_VERSION");
    assert.equal(opened.length, before, "no catalog was opened");
  });

  test("inline: the request's pull secret is used, never the mounted REGISTRY_AUTH_FILE; the temporary file is removed", async () => {
    const p = await newProfile();
    opened.length = 0;
    const r = await api("POST", "/api/operators/scan", { catalogMinor: "4.22", profileId: p.id, rhAuthSource: "inline", pullSecret: SECRET });
    assert.equal(r.status, 200, r.text);
    for (const id of Object.values(r.json.jobs)) await terminal(id);
    assert.equal(opened.length, 3);
    for (const o of opened) {
      assert.notEqual(o.authFile, process.env.REGISTRY_AUTH_FILE);
      assert.match(o.authFileContents, new RegExp(SECRET_B64.replace(/[+/=]/g, "\\$&")));
      assert.equal(fs.existsSync(o.authFile), false, "temporary auth file removed after the scan");
    }
  });
});

describe("Mirroring scans in Operations; failures keep their reason (FQ-SCAN-4)", () => {
  test("three catalog jobs, linked as one scan, with counts; a failed catalog keeps its reason and output; no secret anywhere", async () => {
    const p = await newProfile();
    failCatalogs.add("certified");
    let jobs;
    try {
      const r = await api("POST", "/api/operators/scan", { catalogMinor: "4.22", profileId: p.id, rhAuthSource: "inline", pullSecret: SECRET });
      assert.equal(r.status, 200, r.text);
      jobs = r.json.jobs;
      for (const id of Object.values(jobs)) await terminal(id);
    } finally {
      failCatalogs.delete("certified");
    }
    const list = (await api("GET", "/api/mirroring/operations")).json.operations;
    const mine = list.filter((o) => Object.values(jobs).includes(o.jobId));
    assert.equal(mine.length, 3, "each catalog job is listed");
    for (const o of mine) {
      assert.equal(o.kind, "catalog-scan");
      assert.equal(o.profileId, p.id);
      assert.equal(o.profileExists, true);
      assert.equal(o.catalogMinor, "4.22");
      assert.equal(o.command, undefined, "a scan has no oc-mirror mirroring command");
      assert.equal(o.links.length, 2, "linked to the other two catalogs of the same scan");
    }
    const redhat = mine.find((o) => o.catalogId === "redhat");
    assert.equal(redhat.status, "completed");
    assert.equal(redhat.packages, 2);
    assert.equal(redhat.title, "Catalog scan — Red Hat catalog (OpenShift 4.22)");
    const certified = mine.find((o) => o.catalogId === "certified");
    assert.equal(certified.status, "failed");
    assert.equal(certified.failureReason, "registry.redhat.io denied access to redhat/certified-operator-index (403).");
    const job = (await api("GET", `/api/jobs/${jobs.certified}`)).json;
    assert.match(job.output, /denied access to redhat\/certified-operator-index \(403\)/, "the reason stays in the output");
    const detail = (await api("GET", `/api/mirroring/operations/${jobs.certified}`)).json.operation;
    assert.equal(detail.failureReason, certified.failureReason);
    const log = await api("GET", `/api/mirroring/operations/${jobs.certified}/log`);
    assert.equal(log.status, 200);
    assert.match(log.text, /denied access/);
    const everything = JSON.stringify(list) + log.text + JSON.stringify(await api("GET", `/api/jobs/${jobs.redhat}`));
    assert.doesNotMatch(everything, new RegExp(`${SECRET_B64.replace(/[+/=]/g, "\\$&")}|scan-canary-9f3`));
  });

  test("a scan without a profile (Install, or an older client) is not listed as Mirroring", async () => {
    const r = await api("POST", "/api/operators/scan", { catalogMinor: "4.22", pullSecret: SECRET });
    assert.equal(r.status, 200, r.text);
    for (const id of Object.values(r.json.jobs)) await terminal(id);
    const ids = new Set((await api("GET", "/api/mirroring/operations")).json.operations.map((o) => o.jobId));
    for (const id of Object.values(r.json.jobs)) assert.equal(ids.has(id), false);
  });

  test("oc-mirror listing failure: the reason names oc-mirror's error and the output is kept", async () => {
    const p = await newProfile();
    const bin = path.join(scratch, "oc-mirror-fails");
    fs.writeFileSync(bin, '#!/bin/sh\ncase "$*" in *version*) echo "stub"; exit 0 ;; esac\necho "starting listing"\necho "[ERROR]  : catalog index is corrupt" >&2\nexit 1\n', { mode: 0o755 });
    const prev = process.env.OC_MIRROR_BIN;
    process.env.OC_MIRROR_BIN = bin;
    try {
      const r = await api("POST", "/api/operators/scan", { catalogMinor: "4.22", profileId: p.id, rhAuthSource: "inline", pullSecret: SECRET });
      const job = await terminal(r.json.jobs.redhat);
      assert.equal(job.status, "failed");
      assert.match(job.message, /oc-mirror could not list the catalog \(exit code 1\): catalog index is corrupt/);
      assert.match(job.output, /starting listing/);
      assert.match(job.output, /verified over TLS/, "earlier lines are not replaced");
      assert.equal(JSON.parse(job.metadata_json).failure.code, "LIST_FAILED");
      for (const id of Object.values(r.json.jobs)) await terminal(id);
    } finally {
      process.env.OC_MIRROR_BIN = prev;
    }
  });
});
