/**
 * v2.3.0 P0a — N4: the server-side run contract matches the preflight.
 *
 * Before this fix (617d037) the preflight blocked a destination run without
 * destination credentials, but POST /api/mirroring/profiles/:id/run, the
 * Install /api/ocmirror/run and the "Run the same again" retry accepted
 * `mirrorAuthSource: "inline"` with `mirrorPullSecret` omitted and spawned
 * oc-mirror without destination credentials. A missing trust-store file was
 * likewise only a preflight blocker.
 *
 * Contract now: a disk-to-mirror or mirror-to-mirror run needs either real
 * destination credentials or the explicit `destinationAuth: "anonymous"`
 * choice (the server then supplies the OKD placeholder itself). Missing
 * credentials and a broken trust store refuse the run with 409
 * PREFLIGHT_BLOCKED before anything is spawned.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { app } from "../src/index.js";
import { OKD_PLACEHOLDER_AUTH } from "../src/ocMirrorPreflightItems.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";
import { resetMirroringForTests } from "./helpers/resetWorkflowsForTests.js";

const DATA_DIR = path.resolve(process.env.DATA_DIR || "/data");
const DEST_HOST = "mirror.example.invalid:8443/ocp";
const DEST = JSON.stringify({ auths: { "mirror.example.invalid:8443": { auth: Buffer.from("u:p").toString("base64") } } });

let server;
let baseUrl;
let stubDir;
let capture;
const originalBin = process.env.OC_MIRROR_BIN;
const originalCert = process.env.SSL_CERT_FILE;

const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
};
const terminal = async (id) => {
  for (let i = 0; i < 800; i++) {
    const j = (await api("GET", `/api/jobs/${id}`)).json;
    if (j && !["queued", "running"].includes(j.status)) return j;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`job ${id} did not settle`);
};

before(async () => {
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-n4-stub-"));
  capture = path.join(stubDir, "captured-auth.json");
  const p = path.join(stubDir, "oc-mirror");
  fs.writeFileSync(p, `#!${process.execPath}
const fs = require("fs");
const args = process.argv.slice(2);
if (args.includes("version")) { console.log(JSON.stringify({ clientVersion: { gitVersion: "4.22.0-stub-n4", gitCommit: "0" } })); }
else {
  const i = args.indexOf("--authfile");
  fs.writeFileSync(${JSON.stringify(capture)}, i >= 0 ? fs.readFileSync(args[i + 1], "utf8") : "NO-AUTHFILE");
  console.log("stub ran");
}
`);
  fs.chmodSync(p, 0o755);
  process.env.OC_MIRROR_BIN = p;
  ({ server, baseUrl } = await createTestServer(app));
});
after(async () => {
  await resetMirroringForTests();
  await closeTestServer(server);
  if (originalBin === undefined) delete process.env.OC_MIRROR_BIN; else process.env.OC_MIRROR_BIN = originalBin;
  if (originalCert === undefined) delete process.env.SSL_CERT_FILE; else process.env.SSL_CERT_FILE = originalCert;
  fs.rmSync(stubDir, { recursive: true, force: true });
});
beforeEach(async () => {
  fs.rmSync(capture, { force: true });
  if (originalCert === undefined) delete process.env.SSL_CERT_FILE; else process.env.SSL_CERT_FILE = originalCert;
  await resetMirroringForTests();
});

const imagesProfile = async (name) => (await api("POST", "/api/mirroring/profiles", { name, content: { additionalImages: true }, additionalImages: ["registry.example.invalid/a/app:1"] })).json;

describe("Mirroring run route", () => {
  test("mirror to mirror with inline auth and no destination secret is refused before spawning (was 200)", async () => {
    const p = await imagesProfile("n4-m2m");
    const r = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToMirror", registryUrl: DEST_HOST, mirrorAuthSource: "inline" });
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.equal(r.json.code, "PREFLIGHT_BLOCKED");
    assert.ok(r.json.blockers.some((b) => /destination|mirror registry credentials/i.test(b)), JSON.stringify(r.json.blockers));
    assert.equal(fs.existsSync(capture), false, "oc-mirror never started");
  });

  test("an explicit anonymous destination is accepted and the server supplies the OKD placeholder", async () => {
    const p = await imagesProfile("n4-anon");
    const r = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToMirror", registryUrl: DEST_HOST, mirrorAuthSource: "inline", destinationAuth: "anonymous" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    await terminal(r.json.jobId);
    const auth = JSON.parse(fs.readFileSync(capture, "utf8"));
    assert.equal(auth.auths["mirror.example.invalid:8443"].auth, OKD_PLACEHOLDER_AUTH);
  });

  test("real destination credentials still run", async () => {
    const p = await imagesProfile("n4-real");
    const r = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToMirror", registryUrl: DEST_HOST, mirrorAuthSource: "inline", mirrorPullSecret: DEST });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    await terminal(r.json.jobId);
    assert.ok(JSON.parse(fs.readFileSync(capture, "utf8")).auths["mirror.example.invalid:8443"]);
  });

  test("anonymous plus a secret is contradictory and refused", async () => {
    const p = await imagesProfile("n4-both");
    const r = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToMirror", registryUrl: DEST_HOST, mirrorAuthSource: "inline", mirrorPullSecret: DEST, destinationAuth: "anonymous" });
    assert.equal(r.status, 400, JSON.stringify(r.json));
  });

  test("a trust store that points nowhere refuses the run, as the preflight does (was 200)", async () => {
    const p = await imagesProfile("n4-trust");
    process.env.SSL_CERT_FILE = path.join(stubDir, "missing-ca.pem");
    const r = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToMirror", registryUrl: DEST_HOST, mirrorAuthSource: "inline", mirrorPullSecret: DEST });
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.equal(r.json.code, "PREFLIGHT_BLOCKED");
    assert.equal(fs.existsSync(capture), false);
  });

  test("the preflight reports the explicit anonymous choice as satisfied", async () => {
    const p = await imagesProfile("n4-pre");
    const pre = await api("POST", `/api/mirroring/profiles/${p.id}/preflight`, { mode: "mirrorToMirror", registryUrl: DEST_HOST, mirrorAuthSource: "inline", destinationAuth: "anonymous" });
    assert.equal(pre.status, 200);
    assert.equal(pre.json.blockers.some((b) => /credentials are required/i.test(b)), false, JSON.stringify(pre.json.blockers));
    assert.match(pre.json.items.find((i) => i.id === "registry").detail, /anonymous access/);
  });
});

describe("Install run route", () => {
  test("disk to mirror with inline auth and no destination secret is refused (was 200)", async () => {
    const archive = path.join(DATA_DIR, "n4-install-archive");
    fs.mkdirSync(archive, { recursive: true });
    const lock = await api("POST", "/api/state", { version: { versionConfirmed: true }, release: { channel: "stable-4.22", patchVersion: "4.22.16", confirmed: true } });
    assert.equal(lock.status, 200);
    const r = await api("POST", "/api/ocmirror/run", { mode: "diskToMirror", archivePath: archive, registryUrl: DEST_HOST, mirrorAuthSource: "inline", configSourceType: "generated" });
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.equal(r.json.code, "PREFLIGHT_BLOCKED");
    assert.equal(fs.existsSync(capture), false);
    await api("POST", "/api/start-over", { cancelRunningOcMirror: true });
  });
});
