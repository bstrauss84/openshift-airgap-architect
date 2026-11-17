/**
 * v2.3.0 owner QA round 3b (2026-11-17) — stage channels across minors.
 *
 * Reproduced from the owner's plan: "Copy stage 1's operators to later stages" wrote stage 1's
 * channel verbatim into later minors (Mirroring's selected `defaultChannel` is the channel that is
 * MIRRORED), so stage 3's ImageSetConfiguration asked for ODF `stable-4.20` from the 4.22 catalog,
 * even though the scanned 4.22 catalog's default is `stable-4.22`. Each target stage's own catalog
 * now decides: a copied source DEFAULT becomes the target's default; a custom channel is kept and
 * reported unconfirmed; a package missing from the scanned target catalog is not added.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app } from "../src/index.js";
import { db } from "../src/db.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";
import { resetMirroringForTests, resetUpgradeForTests } from "./helpers/resetWorkflowsForTests.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureText = (name) => JSON.stringify(JSON.parse(fs.readFileSync(path.join(here, "fixtures", "upgrade-graph", `${name}.json`), "utf8")).body);
let server;
let baseUrl;
const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
};
const MINORS = ["4.20", "4.21", "4.22"];
const clearScans = () => db.prepare(`DELETE FROM operator_results WHERE version IN (${MINORS.map(() => "?").join(",")})`).run(...MINORS);
const seed = (minor, results) => db.prepare("INSERT INTO operator_results (version, catalog, results_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(version, catalog) DO UPDATE SET results_json = excluded.results_json, updated_at = excluded.updated_at").run(minor, "redhat", JSON.stringify(results), Date.now());

before(async () => {
  ({ server, baseUrl } = await createTestServer(app));
  for (const ch of ["stable-4.22", "stable-4.21", "stable-4.20"]) {
    assert.equal((await api("POST", "/api/upgrade/graph/import", { channel: ch, arch: "amd64", origin: "snapshot", text: fixtureText(`${ch}-amd64`) })).status, 200);
  }
});
after(async () => { clearScans(); await resetMirroringForTests(); await resetUpgradeForTests(); await closeTestServer(server); });
beforeEach(async () => { clearScans(); await resetMirroringForTests(); await resetUpgradeForTests(); });

const stagedPlan = async () => {
  const p = (await api("POST", "/api/upgrade/plans", { name: "qa3b" })).json;
  await api("POST", `/api/upgrade/plans/${p.id}`, { arch: "amd64", graphSource: "imported", currentChannel: "stable-4.20", current: "4.20.14", target: "4.22.22" });
  assert.equal((await api("POST", `/api/upgrade/plans/${p.id}/solve`, {})).status, 200);
  return (await api("POST", `/api/upgrade/plans/${p.id}/stages`, {})).json.plan;
};
const profilesOf = async (plan) => {
  const all = (await api("GET", "/api/mirroring")).json.profiles;
  return plan.stages.map((s) => all.find((x) => x.id === s.profileId));
};
const op = (name, channel) => ({ id: `registry.redhat.io/redhat/redhat-operator-index:v4.20::${name}`, name, catalog: "redhat", catalogImage: "registry.redhat.io/redhat/redhat-operator-index:v4.20", defaultChannel: channel });

describe("copying operators to later stages uses each stage's own catalog", () => {
  test("a copied default becomes the later catalog's default (ODF stable-4.20 → stable-4.21); unscanned, custom and missing cases are explicit", async () => {
    const plan = await stagedPlan();
    const [p1] = await profilesOf(plan);
    assert.equal((await api("POST", `/api/mirroring/profiles/${p1.id}`, { content: { platform: true, operators: true, additionalImages: false }, operators: { selected: [
      op("odf-operator", "stable-4.20"), op("local-storage-operator", "stable"), op("custom-op", "fast"), op("gone-op", "stable")
    ] } })).status, 200);
    seed("4.20", [{ name: "odf-operator", defaultChannel: "stable-4.20" }, { name: "local-storage-operator", defaultChannel: "stable" }, { name: "custom-op", defaultChannel: "stable" }, { name: "gone-op", defaultChannel: "stable" }]);
    seed("4.21", [{ name: "odf-operator", defaultChannel: "stable-4.21" }, { name: "local-storage-operator", defaultChannel: "stable" }, { name: "custom-op", defaultChannel: "stable" }]);
    // 4.22 is not scanned.
    const r = await api("POST", `/api/upgrade/plans/${plan.id}/stages/s1/copy-operators`, {});
    assert.equal(r.status, 200, r.text);
    const by = Object.fromEntries(r.json.report.map((x) => [x.stageId, Object.fromEntries(x.checks.map((c) => [c.name, c]))]));
    assert.deepEqual(by.s2["odf-operator"], { name: "odf-operator", from: "stable-4.20", channel: "stable-4.21", status: "default-channel", targetDefault: "stable-4.21" });
    assert.equal(by.s2["local-storage-operator"].channel, "stable");
    assert.deepEqual([by.s2["custom-op"].channel, by.s2["custom-op"].status, by.s2["custom-op"].targetDefault], ["fast", "channel-not-checked", "stable"], "a custom channel is kept, reported unconfirmed");
    assert.equal(by.s2["gone-op"].status, "not-in-catalog");
    assert.equal(by.s3["odf-operator"].status, "not-scanned");
    const [, b, c] = await profilesOf(plan);
    const ch = (p, name) => p.operators.selected.find((o) => o.name === name)?.defaultChannel;
    assert.equal(ch(b, "odf-operator"), "stable-4.21");
    assert.equal(b.operators.selected.some((o) => o.name === "gone-op"), false, "not added where the scanned catalog lacks it");
    assert.equal(ch(c, "odf-operator"), "stable-4.20", "4.22 not scanned: kept, and reported not scanned");
    // What would be mirrored for stage 2 is the 4.21 channel.
    const yaml = (await api("POST", `/api/mirroring/profiles/${b.id}/preview`, {})).json.imagesetConfig;
    assert.match(yaml, /- name: odf-operator\n\s+channels:\n\s+- name: stable-4\.21/);
    assert.doesNotMatch(yaml, /stable-4\.20/);
  });
});

describe("adding imported operators to every stage uses each stage's own catalog", () => {
  test("an operator without a channel gets each scanned stage's default; one missing from a scanned catalog is reported, not added", async () => {
    const plan = await stagedPlan();
    seed("4.20", [{ name: "odf-operator", defaultChannel: "stable-4.20" }]);
    seed("4.21", [{ name: "odf-operator", defaultChannel: "stable-4.21" }]);
    seed("4.22", [{ name: "something-else", defaultChannel: "stable" }]);
    assert.equal((await api("POST", `/api/upgrade/plans/${plan.id}/operator-intent`, { entries: [{ name: "odf-operator", catalogKind: "redhat", channel: null, category: "requested", confidence: "user-entered", sources: [] }] })).status, 200);
    const r = await api("POST", `/api/upgrade/plans/${plan.id}/operator-intent/apply-to-stages`, { keys: ["redhat|odf-operator"] });
    assert.equal(r.status, 200, r.text);
    const [a, b, c] = await profilesOf(plan);
    assert.equal(a.operators.selected.find((o) => o.name === "odf-operator").defaultChannel, "stable-4.20");
    assert.equal(b.operators.selected.find((o) => o.name === "odf-operator").defaultChannel, "stable-4.21");
    assert.equal(c.operators.selected.some((o) => o.name === "odf-operator"), false);
    assert.deepEqual(r.json.report.find((x) => x.stageId === "s3").missing, ["odf-operator"]);
  });
});
