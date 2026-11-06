/**
 * v2.3.0 P7 — the upgrade plan package and its offline import.
 *
 *  - The package carries the plan, re-verifiable graph snapshots, validated
 *    stage configurations, instructions, readiness and templates; never
 *    archives, credentials, inventory or attestation notes.
 *  - Integrity is checked before anything is imported; a changed byte is
 *    refused and nothing is written. Integrity is described as such, never
 *    as authenticity.
 *  - The imported plan is read-only, uses the snapshots (labelled as such),
 *    and links each stage to the received transfer of its connected-side
 *    profile.
 *  - Tools: acquisition guidance only (no binaries in Mirroring/Upgrade).
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app } from "../src/index.js";
import { getState, setState } from "../src/utils.js";
import { canonicalJson } from "../src/upgradePackage.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";
import { resetMirroringForTests, resetUpgradeForTests } from "./helpers/resetWorkflowsForTests.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureText = (name) => JSON.stringify(JSON.parse(fs.readFileSync(path.join(here, "fixtures", "upgrade-graph", `${name}.json`), "utf8")).body);

let server;
let baseUrl;
const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
};
before(async () => {
  ({ server, baseUrl } = await createTestServer(app));
  for (const ch of ["stable-4.22", "stable-4.21", "stable-4.20"]) {
    assert.equal((await api("POST", "/api/upgrade/graph/import", { channel: ch, arch: "amd64", origin: "snapshot", text: fixtureText(`${ch}-amd64`), capturedAt: "2026-11-06T16:50:00Z" })).status, 200);
  }
});
after(async () => {
  await resetMirroringForTests();
  await resetUpgradeForTests();
  await closeTestServer(server);
});
beforeEach(async () => {
  await resetMirroringForTests();
  await resetUpgradeForTests();
});

const stagedPlan = async () => {
  const p = (await api("POST", "/api/upgrade/plans", { name: "pkg" })).json;
  await api("POST", `/api/upgrade/plans/${p.id}`, { arch: "amd64", graphSource: "imported", current: "4.20.14", target: "4.22.22" });
  assert.equal((await api("POST", `/api/upgrade/plans/${p.id}/solve`, {})).status, 200);
  const staged = (await api("POST", `/api/upgrade/plans/${p.id}/stages`, {})).json.plan;
  const cv = { kind: "ClusterVersion", spec: { clusterID: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", channel: "stable-4.20" }, status: { desired: { version: "4.20.14" }, conditions: [] } };
  assert.equal((await api("POST", `/api/upgrade/plans/${p.id}/inventory`, { kind: "clusterversion", text: JSON.stringify(cv) })).status, 200);
  assert.equal((await api("POST", `/api/upgrade/plans/${p.id}/attest`, { checkId: "etcd-backup", attested: true, note: "private note" })).status, 200);
  return staged;
};

describe("package export", () => {
  test("machine-readable package: snapshots and stage configs re-verifiable; no inventory, notes or credentials", async () => {
    const plan = await stagedPlan();
    const doc = (await api("GET", `/api/upgrade/plans/${plan.id}/package.json`)).json;
    assert.equal(doc._schema, "oaa.upgrade.package/v1");
    assert.equal(doc.contentSha256, crypto.createHash("sha256").update(canonicalJson(doc.content)).digest("hex"));
    assert.match(doc.integrity, /does not authenticate/);
    assert.ok(doc.content.snapshots.length >= 1);
    for (const s of doc.content.snapshots) assert.equal(crypto.createHash("sha256").update(s.rawText).digest("hex"), s.bodySha256);
    assert.equal(doc.content.stages.length, 3);
    for (const st of doc.content.stages) assert.equal(crypto.createHash("sha256").update(st.imagesetConfig).digest("hex"), st.configSha256);
    const text = JSON.stringify(doc);
    for (const leak of ["aaaaaaaa-bbbb", "private note", "\"auths\""]) assert.equal(text.includes(leak), false, leak);
    assert.equal("inventory" in doc.content.plan, false);
    assert.equal(doc.content.tools.redistribution, "not-included");
    assert.match(doc.content.tools.oc.directory, /\/clients\/ocp\/latest-4\.22\/$/);
  });

  test("zip: package JSON, README, instructions, stage configs, templates, tools guidance and SHA256SUMS", async () => {
    const plan = await stagedPlan();
    const res = await fetch(`${baseUrl}/api/upgrade/plans/${plan.id}/package.zip`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/zip");
    const buf = Buffer.from(await res.arrayBuffer());
    const names = ["oaa-upgrade-package.json", "README.txt", "instructions/osus.md", "instructions/cli.md", "instructions/web.md", "stages/stage-1-4.20.44/imageset-config.yaml", "templates/updateservice.yaml", "readiness.json", "tools/ACQUIRE_TOOLS.md", "SHA256SUMS"];
    for (const n of names) assert.ok(buf.includes(Buffer.from(`oaa-upgrade-${plan.id}/${n}`)), n);
    assert.equal(buf.includes(Buffer.from("aaaaaaaa-bbbb")), false);
    // Compressed members are not searchable; the readiness/notes guarantee is asserted on package.json above.
  });
});

describe("offline import", () => {
  test("a tampered package is refused and nothing is imported", async () => {
    const plan = await stagedPlan();
    const doc = (await api("GET", `/api/upgrade/plans/${plan.id}/package.json`)).json;
    const tampered = JSON.parse(JSON.stringify(doc));
    tampered.content.plan.target = "4.22.21";
    const before = (await api("GET", "/api/upgrade")).json.plans.length;
    const r = await api("POST", "/api/upgrade/import", { text: JSON.stringify(tampered) });
    assert.equal(r.status, 422);
    assert.equal(r.json.code, "PACKAGE_TAMPERED");
    assert.equal((await api("GET", "/api/upgrade")).json.plans.length, before);
    const snap = JSON.parse(JSON.stringify(doc));
    snap.content.snapshots[0].rawText = snap.content.snapshots[0].rawText.replace("4.22.22", "4.22.99");
    snap.contentSha256 = crypto.createHash("sha256").update(canonicalJson(snap.content)).digest("hex");
    assert.equal((await api("POST", "/api/upgrade/import", { text: JSON.stringify(snap) })).json.code, "PACKAGE_TAMPERED", "a recomputed outer hash cannot hide a changed snapshot");
    assert.equal((await api("POST", "/api/upgrade/import", { text: JSON.stringify({ ...doc, _schema: "oaa.upgrade.package/v9" }) })).json.code, "PACKAGE_SCHEMA_UNKNOWN");
  });

  test("a verified package becomes a read-only received plan whose stages link to received transfers", async () => {
    const plan = await stagedPlan();
    const doc = (await api("GET", `/api/upgrade/plans/${plan.id}/package.json`)).json;
    const r = await api("POST", "/api/upgrade/import", { text: JSON.stringify(doc) });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    const received = r.json.plan;
    assert.equal(received.kind, "received");
    assert.equal(received.origin.packageSha256, doc.contentSha256);
    assert.deepEqual(received.path.path, ["4.20.14", "4.20.44", "4.21.40", "4.22.22"]);
    assert.equal((await api("POST", `/api/upgrade/plans/${received.id}`, { target: "4.21.40" })).json.code, "PLAN_READ_ONLY");
    assert.ok(received.stageViews.every((s) => s.content.state === "profile-missing"), "no transfer received yet");
    // Simulate Mirroring > Receive transfer having created the received profile of stage 1.
    const stage1 = doc.content.stages[0];
    const state = getState();
    const id = "p-recvstage01";
    state.mirroring.profiles[id] = {
      id, name: "received stage 1", kind: "received",
      origin: { profileId: stage1.originProfileId, profileName: "x", planId: "plan-20261106T170000Z-abcdef", planSha256: "a".repeat(64), jobId: null },
      content: { platform: true, operators: false, additionalImages: false }, platform: {}, operators: { selected: [] }, additionalImages: [], history: [],
      received: [{ planId: "plan-20261106T170000Z-abcdef", configSha256: stage1.configSha256, manifestSha256: "b".repeat(64), receivedAt: Date.now(), archives: [] }]
    };
    setState(state);
    const views = (await api("GET", "/api/upgrade")).json.plans.find((p) => p.id === received.id).stageViews;
    assert.equal(views[0].linkedProfileId, id);
    assert.equal(views[0].received, true);
    assert.ok(["transfer-received", "planned"].includes(views[0].content.state));
    const ready = (await api("GET", `/api/upgrade/plans/${received.id}/readiness`)).json;
    assert.equal(ready.checks.find((c) => c.id === "graph-freshness").state, "WARNING", "a received plan's graph is a snapshot, never live");
  });
});
