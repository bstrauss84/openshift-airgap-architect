/**
 * v2.3.0 correction pass — the server-side run contract also enforces the
 * source (Red Hat) pull-secret rule the preflight applies.
 *
 * Mirror to disk and mirror to mirror pull from the source registries. When
 * the content comes from Red Hat (any platform or operator content, and every
 * Install run) the preflight requires a Red Hat pull secret; before this fix
 * the run endpoints accepted a request without one and started oc-mirror.
 * Content without Red Hat sources (additional images only) may pull
 * anonymously, as the preflight allows, but a given secret must be valid.
 * Disk to mirror reads local archives and needs no source credential.
 *
 * Fail-first: the "refused" cases returned 200 on aee6a32.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { app } from "../src/index.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";
import { resetMirroringForTests } from "./helpers/resetWorkflowsForTests.js";

const DATA_DIR = path.resolve(process.env.DATA_DIR || "/data");
const RH = JSON.stringify({ auths: { "registry.redhat.io": { auth: Buffer.from("u:p").toString("base64") } } });
const OTHER = JSON.stringify({ auths: { "registry.example.invalid": { auth: Buffer.from("u:p").toString("base64") } } });
const DEST = JSON.stringify({ auths: { "mirror.example.invalid:8443": { auth: Buffer.from("d:p").toString("base64") } } });

let server;
let baseUrl;
let stubDir;
let marker;
const originalBin = process.env.OC_MIRROR_BIN;
const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
};
const settle = async (id) => {
  for (let i = 0; i < 400; i++) {
    const j = (await api("GET", `/api/jobs/${id}`)).json;
    if (j && !["queued", "running"].includes(j.status)) return j;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("not settled");
};

before(async () => {
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-srccred-stub-"));
  marker = path.join(stubDir, "spawned");
  const p = path.join(stubDir, "oc-mirror");
  fs.writeFileSync(p, `#!${process.execPath}
const args = process.argv.slice(2);
if (args.includes("version")) console.log(JSON.stringify({ clientVersion: { gitVersion: "4.22.0-stub-src", gitCommit: "0" } }));
else require("fs").writeFileSync(${JSON.stringify(marker)}, "x");
`);
  fs.chmodSync(p, 0o755);
  process.env.OC_MIRROR_BIN = p;
  ({ server, baseUrl } = await createTestServer(app));
});
after(async () => {
  await resetMirroringForTests();
  await api("POST", "/api/start-over", { cancelInstallRuns: true });
  await closeTestServer(server);
  if (originalBin === undefined) delete process.env.OC_MIRROR_BIN; else process.env.OC_MIRROR_BIN = originalBin;
  fs.rmSync(stubDir, { recursive: true, force: true });
});
beforeEach(async () => {
  fs.rmSync(marker, { force: true });
  await resetMirroringForTests();
});

const platformProfile = async () => {
  const p = (await api("POST", "/api/mirroring/profiles", { name: "plat", content: { platform: true }, platform: { release: { channel: "4.22", patchVersion: "4.22.16" } } })).json;
  const locked = await api("POST", `/api/mirroring/profiles/${p.id}/lock`, {});
  assert.equal(locked.status, 200, JSON.stringify(locked.json));
  return locked.json;
};
const imagesProfile = async () => (await api("POST", "/api/mirroring/profiles", { name: "img", content: { additionalImages: true }, additionalImages: ["registry.example.invalid/a/app:1"] })).json;

describe("Mirroring runs with Red Hat content", () => {
  test("mirror to disk without a Red Hat pull secret is refused before spawning (was 200)", async () => {
    const p = await platformProfile();
    const r = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToDisk" });
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.equal(r.json.code, "PREFLIGHT_BLOCKED");
    assert.ok(r.json.blockers.some((b) => /Red Hat pull secret/.test(b)));
    assert.equal(fs.existsSync(marker), false);
  });
  test("a secret without any Red Hat registry is refused for Red Hat content (was 200)", async () => {
    const p = await platformProfile();
    const r = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToMirror", registryUrl: "mirror.example.invalid:8443/ocp", rhPullSecret: OTHER, mirrorAuthSource: "inline", mirrorPullSecret: DEST });
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.equal(fs.existsSync(marker), false);
  });
  test("with a Red Hat pull secret the run starts", async () => {
    const p = await platformProfile();
    const r = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToDisk", rhPullSecret: RH });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    await settle(r.json.jobId);
  });
});

describe("content without Red Hat sources", () => {
  test("additional images only may run without a pull secret (as the preflight allows)", async () => {
    const p = await imagesProfile();
    const r = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToDisk" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    await settle(r.json.jobId);
  });
});

describe("Install runs", () => {
  test("Install mirror to disk without a Red Hat pull secret is refused (was 200)", async () => {
    const lock = await api("POST", "/api/state", { version: { versionConfirmed: true }, release: { channel: "stable-4.22", patchVersion: "4.22.16", confirmed: true } });
    assert.equal(lock.status, 200);
    const r = await api("POST", "/api/ocmirror/run", { mode: "mirrorToDisk", archivePath: path.join(DATA_DIR, "srccred-install") });
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.equal(r.json.code, "PREFLIGHT_BLOCKED");
    assert.equal(fs.existsSync(marker), false);
  });
});
