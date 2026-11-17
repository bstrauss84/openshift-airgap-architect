/**
 * v2.3.0 owner QA (2026-11-17), P1 — the QA job history showed each catalog digest scanned 5–7
 * times, including two identical three-catalog sets started ~60 ms apart. The server now returns a
 * scan already queued or running for the same catalog image and minor (from any caller) instead
 * of downloading it again, and can retry a subset of catalogs.
 *
 * No network: the "in-flight" scans are job records created here; a request whose catalogs are
 * all in flight returns before any scan process would start.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { app } from "../src/index.js";
import { createJob, updateJob, updateJobMetadata, listJobsByType } from "../src/utils.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

const SECRET = JSON.stringify({ auths: { "registry.redhat.io": { auth: Buffer.from(["u", "dedupe-canary"].join(":")).toString("base64") } } });
let server;
let baseUrl;
let stubDir;
const originalBin = process.env.OC_MIRROR_BIN;
const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const inFlight = (minor, catalogId, status = "running") => {
  const id = createJob("operator-scan", `Scanning ${catalogId} operators...`);
  updateJob(id, { status, progress: 30 });
  updateJobMetadata(id, { workflow: "mirroring", catalogId, catalogImage: `registry.redhat.io/redhat/${catalogId}-operator-index:v${minor}`, catalogMinor: minor });
  return id;
};

before(async () => {
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-dedupe-stub-"));
  const p = path.join(stubDir, "oc-mirror");
  fs.writeFileSync(p, `#!${process.execPath}\nif (process.argv.includes("version")) console.log(JSON.stringify({ clientVersion: { gitVersion: "4.22.0-stub-dedupe", gitCommit: "0" } }));\n`);
  fs.chmodSync(p, 0o755);
  process.env.OC_MIRROR_BIN = p;
  ({ server, baseUrl } = await createTestServer(app));
});
after(async () => {
  await closeTestServer(server);
  if (originalBin === undefined) delete process.env.OC_MIRROR_BIN; else process.env.OC_MIRROR_BIN = originalBin;
  fs.rmSync(stubDir, { recursive: true, force: true });
});

describe("catalog scans are deduplicated by catalog identity", () => {
  test("a second request for a minor whose three catalogs are already being scanned attaches to those jobs", async () => {
    const ids = { redhat: inFlight("4.21", "redhat"), certified: inFlight("4.21", "certified", "queued"), community: inFlight("4.21", "community") };
    const before = listJobsByType("operator-scan").length;
    const r = await api("POST", "/api/operators/scan", { catalogMinor: "4.21", rhAuthSource: "inline", pullSecret: SECRET });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.jobs, ids);
    assert.deepEqual(r.json.reused.sort(), ["certified", "community", "redhat"]);
    assert.equal(listJobsByType("operator-scan").length, before, "no new scan job");
    for (const id of Object.values(ids)) updateJob(id, { status: "completed", progress: 100 });
  });

  test("finished scans and other minors are not reused; a catalog subset is honoured", async () => {
    const done = inFlight("4.22", "redhat", "completed");
    const other = inFlight("4.20", "redhat");
    const subset = await api("POST", "/api/operators/scan", { catalogMinor: "4.20", rhAuthSource: "inline", pullSecret: SECRET, catalogs: ["redhat"] });
    assert.equal(subset.status, 200, JSON.stringify(subset.json));
    assert.deepEqual(subset.json.jobs, { redhat: other }, "only the requested catalog, attached to its running scan");
    assert.deepEqual(subset.json.reused, ["redhat"]);
    assert.notEqual(subset.json.jobs.redhat, done);
    updateJob(other, { status: "completed", progress: 100 });
    const bad = await api("POST", "/api/operators/scan", { catalogMinor: "4.20", rhAuthSource: "inline", pullSecret: SECRET, catalogs: ["nope"] });
    assert.equal(bad.status, 400);
  });
});
