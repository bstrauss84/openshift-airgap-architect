/**
 * v2.3.0 P4 — reviewed stage sequences (RFC §8.5).
 *
 * A sequence runs stage after stage through the same preflight and run
 * handlers as a manual Mirroring run. It needs the reviewed scope (token),
 * runs in plan order, stops at the first blocked preflight / failed run, can
 * be stopped, and never writes a credential to job metadata or the database.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app } from "../src/index.js";
import { getJobMetadata } from "../src/utils.js";
import { db } from "../src/db.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";
import { resetMirroringForTests, resetUpgradeForTests } from "./helpers/resetWorkflowsForTests.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureText = (name) => JSON.stringify(JSON.parse(fs.readFileSync(path.join(here, "fixtures", "upgrade-graph", `${name}.json`), "utf8")).body);
const CANARY = "seq-canary-4c1d";
const SECRET = JSON.stringify({ auths: { "registry.redhat.io": { auth: Buffer.from(`u:${CANARY}`).toString("base64") } } });

let server;
let baseUrl;
let stubDir;
const originalBin = process.env.OC_MIRROR_BIN;
const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
};
const settle = async (id, ms = 30000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const j = (await api("GET", `/api/jobs/${id}`)).json;
    if (j && !["queued", "running"].includes(j.status)) return j;
    if (Date.now() > deadline) throw new Error(`job ${id} did not settle`);
    await new Promise((r) => setTimeout(r, 40));
  }
};

before(async () => {
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-seq-stub-"));
  const p = path.join(stubDir, "oc-mirror");
  fs.writeFileSync(p, `#!${process.execPath}
const fs = require("fs"); const path = require("path"); const { spawnSync } = require("child_process");
const args = process.argv.slice(2);
if (args.includes("version")) { console.log(JSON.stringify({ clientVersion: { gitVersion: "4.22.0-stub-seq", gitCommit: "0" } })); }
else {
  const cfg = fs.readFileSync(args[args.indexOf("--config") + 1], "utf8");
  if (process.env.STUB_ORDER) fs.appendFileSync(process.env.STUB_ORDER, (cfg.match(/minVersion: (\\S+)/) || [])[1] + "\\n");
  if (process.env.STUB_FAIL_RELEASE && cfg.includes("minVersion: " + process.env.STUB_FAIL_RELEASE)) { console.log("synthetic failure"); process.exitCode = 1; }
  else {
    const dest = args.find((a) => a.startsWith("file://") && args[args.indexOf(a) - 1] !== "--workspace" && args[args.indexOf(a) - 1] !== "--from");
    const finish = () => {
      if (dest) {
        const dir = dest.slice(7); fs.mkdirSync(dir, { recursive: true });
        const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "stub-wd-"));
        fs.mkdirSync(path.join(tmp, "working-dir"), { recursive: true });
        fs.writeFileSync(path.join(tmp, "working-dir", "x.txt"), "x");
        spawnSync("tar", ["-cf", path.join(dir, "mirror_000001.tar"), "-C", tmp, "working-dir"]);
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    };
    const ms = Number(process.env.STUB_SLEEP_MS || 0);
    if (ms) setTimeout(finish, ms); else finish();
  }
}
`);
  fs.chmodSync(p, 0o755);
  process.env.OC_MIRROR_BIN = p;
  ({ server, baseUrl } = await createTestServer(app));
  for (const ch of ["stable-4.22", "stable-4.21", "stable-4.20"]) {
    assert.equal((await api("POST", "/api/upgrade/graph/import", { channel: ch, arch: "amd64", origin: "snapshot", text: fixtureText(`${ch}-amd64`) })).status, 200);
  }
});
after(async () => {
  for (const k of ["STUB_SLEEP_MS", "STUB_FAIL_RELEASE", "STUB_ORDER"]) delete process.env[k];
  await resetMirroringForTests();
  await resetUpgradeForTests();
  await closeTestServer(server);
  if (originalBin === undefined) delete process.env.OC_MIRROR_BIN; else process.env.OC_MIRROR_BIN = originalBin;
  fs.rmSync(stubDir, { recursive: true, force: true });
});
beforeEach(async () => {
  for (const k of ["STUB_SLEEP_MS", "STUB_FAIL_RELEASE", "STUB_ORDER"]) delete process.env[k];
  await resetMirroringForTests();
  await resetUpgradeForTests();
});

const stagedPlan = async () => {
  const p = (await api("POST", "/api/upgrade/plans", { name: "seq" })).json;
  await api("POST", `/api/upgrade/plans/${p.id}`, { arch: "amd64", graphSource: "imported", current: "4.20.14", target: "4.22.22" });
  assert.equal((await api("POST", `/api/upgrade/plans/${p.id}/solve`, {})).status, 200);
  const staged = await api("POST", `/api/upgrade/plans/${p.id}/stages`, {});
  assert.equal(staged.status, 200, JSON.stringify(staged.json));
  return staged.json.plan;
};
const review = async (plan, body) => {
  const r = await api("POST", `/api/upgrade/plans/${plan.id}/sequence/preview`, body);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
};

describe("stage sequences", () => {
  test("needs the reviewed scope; a changed scope is refused", async () => {
    const plan = await stagedPlan();
    const preview = await review(plan, { mode: "mirrorToDisk" });
    assert.equal(preview.stages.length, 3);
    assert.equal(preview.stopsOnFirstFailure, true);
    assert.equal(JSON.stringify(preview).includes(CANARY), false);
    assert.equal((await api("POST", `/api/upgrade/plans/${plan.id}/sequence`, { mode: "mirrorToDisk", rhPullSecret: SECRET })).json.code, "SEQUENCE_NOT_REVIEWED");
    const changed = await api("POST", `/api/upgrade/plans/${plan.id}/sequence`, { mode: "mirrorToDisk", stageIds: ["s1"], rhPullSecret: SECRET, previewToken: preview.token });
    assert.equal(changed.status, 409);
    assert.equal(changed.json.code, "SEQUENCE_SCOPE_CHANGED");
  });

  test("runs every stage in update order through the Mirroring engine, without storing credentials", async () => {
    const plan = await stagedPlan();
    const order = path.join(stubDir, "order.txt");
    process.env.STUB_ORDER = order;
    const preview = await review(plan, { mode: "mirrorToDisk" });
    const start = await api("POST", `/api/upgrade/plans/${plan.id}/sequence`, { mode: "mirrorToDisk", rhPullSecret: SECRET, previewToken: preview.token });
    assert.equal(start.status, 202, JSON.stringify(start.json));
    const seq = await settle(start.json.jobId);
    assert.equal(seq.status, "completed", seq.message);
    assert.match(seq.message, /cluster itself has not been updated/);
    assert.deepEqual(fs.readFileSync(order, "utf8").trim().split("\n"), ["4.20.44", "4.21.40", "4.22.22"]);
    const meta = getJobMetadata(start.json.jobId);
    assert.deepEqual(meta.stages.map((s) => s.state), ["mirrored-to-disk", "mirrored-to-disk", "mirrored-to-disk"]);
    for (const s of meta.stages) assert.equal(getJobMetadata(s.jobId).owner.planId, plan.id);
    const views = (await api("GET", "/api/upgrade")).json.plans[0].stageViews;
    assert.ok(views.every((v) => v.content.state === "mirrored-to-disk"));
    const dump = JSON.stringify(db.prepare("SELECT * FROM jobs").all()) + JSON.stringify(db.prepare("SELECT * FROM app_state").all());
    assert.equal(dump.includes(CANARY), false, "no credential in the database");
    assert.equal(dump.includes(Buffer.from(`u:${CANARY}`).toString("base64")), false);
  });

  test("stops at the first failed stage; later stages are not run", async () => {
    const plan = await stagedPlan();
    process.env.STUB_FAIL_RELEASE = "4.21.40";
    const preview = await review(plan, { mode: "mirrorToDisk" });
    const start = await api("POST", `/api/upgrade/plans/${plan.id}/sequence`, { mode: "mirrorToDisk", rhPullSecret: SECRET, previewToken: preview.token });
    const seq = await settle(start.json.jobId);
    assert.equal(seq.status, "failed");
    const states = getJobMetadata(start.json.jobId).stages.map((s) => s.state);
    assert.deepEqual(states, ["mirrored-to-disk", "failed", "not-run"]);
  });

  test("a blocked preflight stops the sequence before anything runs (mirror to mirror without destination credentials)", async () => {
    const plan = await stagedPlan();
    const body = { mode: "mirrorToMirror", registryUrl: "mirror.example.invalid:8443/ocp" };
    const preview = await review(plan, body);
    const start = await api("POST", `/api/upgrade/plans/${plan.id}/sequence`, { ...body, rhPullSecret: SECRET, previewToken: preview.token });
    const seq = await settle(start.json.jobId);
    assert.equal(seq.status, "failed");
    const stages = getJobMetadata(start.json.jobId).stages;
    assert.equal(stages[0].state, "preflight-blocked");
    assert.match(stages[0].detail, /credentials/i);
    assert.deepEqual(stages.slice(1).map((s) => s.state), ["not-run", "not-run"]);
    assert.equal(stages[0].jobId, null, "no oc-mirror run started");
  });

  test("Stop stops the current stage and the rest; deleting the plan is refused while it runs", async () => {
    const plan = await stagedPlan();
    process.env.STUB_SLEEP_MS = "5000";
    const preview = await review(plan, { mode: "mirrorToDisk" });
    const start = await api("POST", `/api/upgrade/plans/${plan.id}/sequence`, { mode: "mirrorToDisk", rhPullSecret: SECRET, previewToken: preview.token });
    for (let i = 0; i < 200 && !getJobMetadata(start.json.jobId).stages[0].jobId; i++) await new Promise((r) => setTimeout(r, 25));
    assert.equal((await api("DELETE", `/api/upgrade/plans/${plan.id}`)).json.code, "STAGE_RUNNING");
    assert.equal((await api("POST", `/api/jobs/${start.json.jobId}/stop`, {})).status, 200);
    const seq = await settle(start.json.jobId);
    assert.equal(seq.status, "cancelled");
    const stages = getJobMetadata(start.json.jobId).stages;
    for (let i = 0; i < 200 && getJobMetadata(start.json.jobId).stages[0].state === "running"; i++) await new Promise((r) => setTimeout(r, 25));
    const final = getJobMetadata(start.json.jobId).stages;
    assert.equal(final[0].state, "stopped");
    assert.equal((await api("GET", `/api/jobs/${final[0].jobId}`)).json.status, "cancelled", "the stopped stage run is recorded as cancelled, not failed");
    assert.deepEqual(final.slice(1).map((s) => s.state), ["not-run", "not-run"]);
    await settle(stages[0].jobId);
  });
});
