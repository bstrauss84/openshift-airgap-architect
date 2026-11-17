/**
 * v2.3.0 owner QA (2026-11-17), P0 — route and stage consistency.
 *
 * Root cause reproduced from the QA log: stages prepared at 11:59 stayed in the plan while the route
 * was recomputed eight times (current release, alternative route, conditional review); only a
 * TARGET change marked them stale, so Content showed a two-stage set as the current route and a
 * sequence could mirror it. Staleness is now derived from route vs. stages on every read; sequences
 * refuse a mismatched set; re-preparing carries the released same-minor stage's operators and
 * images into the new stage and says so.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app } from "../src/index.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";
import { resetMirroringForTests, resetUpgradeForTests } from "./helpers/resetWorkflowsForTests.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(here, "fixtures", "upgrade-graph", `${name}.json`), "utf8")).body;
let server;
let baseUrl;
const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
};
before(async () => {
  ({ server, baseUrl } = await createTestServer(app));
  for (const ch of ["stable-4.22", "stable-4.21", "stable-4.20"]) {
    assert.equal((await api("POST", "/api/upgrade/graph/import", { channel: ch, arch: "amd64", origin: "snapshot", text: JSON.stringify(fixture(`${ch}-amd64`)) })).status, 200);
  }
});
after(async () => { await resetMirroringForTests(); await resetUpgradeForTests(); await closeTestServer(server); });
beforeEach(async () => { await resetMirroringForTests(); await resetUpgradeForTests(); });

const newPlan = async () => {
  const p = (await api("POST", "/api/upgrade/plans", { name: "qa3" })).json;
  await api("POST", `/api/upgrade/plans/${p.id}`, { arch: "amd64", graphSource: "imported", currentChannel: "stable-4.20", current: "4.20.14", target: "4.22.22" });
  return p;
};
const solve = async (id, route) => {
  const r = await api("POST", `/api/upgrade/plans/${id}/solve`, route ? { route } : {});
  assert.equal(r.status, 200, r.text);
  return r.json.plan;
};
const plans = async () => (await api("GET", "/api/upgrade")).json.plans;
const profiles = async () => (await api("GET", "/api/mirroring")).json.profiles;
const OP = (minor) => ({ id: `registry.redhat.io/redhat/redhat-operator-index:v${minor}::odf-operator`, name: "odf-operator", catalog: "redhat", catalogImage: `registry.redhat.io/redhat/redhat-operator-index:v${minor}`, defaultChannel: `stable-${minor}`, sources: ["manual"] });

describe("route changes never leave a stale stage set looking current", () => {
  test("choosing another route (same target) marks the prepared stages stale, and a sequence refuses them", async () => {
    const p = await newPlan();
    await solve(p.id);
    const staged = (await api("POST", `/api/upgrade/plans/${p.id}/stages`, {})).json.plan;
    assert.deepEqual(staged.stages.map((s) => s.release), ["4.20.44", "4.21.40", "4.22.22"]);
    assert.equal(staged.stagesStale, false);
    const changed = await solve(p.id, ["4.20.14", "4.20.43", "4.21.40", "4.22.22"]);
    assert.equal(changed.stagesStale, true, "derived from route vs stages, not only from a target change");
    assert.deepEqual(changed.stagesMismatch, { reason: "route-changed", want: ["4.20.43", "4.21.40", "4.22.22"], have: ["4.20.44", "4.21.40", "4.22.22"], missing: ["4.20.43"], extra: ["4.20.44"] });
    const seq = await api("POST", `/api/upgrade/plans/${p.id}/sequence/preview`, { mode: "mirrorToDisk" });
    assert.equal(seq.status, 409);
    assert.equal(seq.json.code, "STAGES_STALE");
    // After a reload the stale state is the same (nothing stored can hide it).
    assert.equal((await plans())[0].stagesStale, true);
  });

  test("changing only the current release (as in the owner's session) also marks them stale", async () => {
    const p = await newPlan();
    await solve(p.id);
    await api("POST", `/api/upgrade/plans/${p.id}/stages`, {});
    await api("POST", `/api/upgrade/plans/${p.id}`, { current: "4.20.44", target: "4.22.22" });
    const cleared = (await plans())[0];
    assert.equal(cleared.stagesStale, true, "route cleared by the selection change");
    assert.equal(cleared.stagesMismatch.reason, "route-cleared");
    const two = await solve(p.id);
    assert.deepEqual(two.path.path, ["4.20.44", "4.21.40", "4.22.22"]);
    assert.equal(two.stagesStale, true);
    assert.deepEqual(two.stagesMismatch.extra, ["4.20.44"]);
  });

  test("re-preparing reuses matching stages, releases the leaving one (data kept) and carries its operators into the new same-minor stage, reported", async () => {
    const p = await newPlan();
    await solve(p.id);
    const staged = (await api("POST", `/api/upgrade/plans/${p.id}/stages`, {})).json.plan;
    const s1 = staged.stages[0].profileId;
    assert.equal((await api("POST", `/api/mirroring/profiles/${s1}`, { content: { platform: true, operators: true, additionalImages: false }, operators: { selected: [OP("4.20")] } })).status, 200);
    await solve(p.id, ["4.20.14", "4.20.43", "4.21.40", "4.22.22"]);
    const r = await api("POST", `/api/upgrade/plans/${p.id}/stages`, {});
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.plan.stages.map((s) => s.release), ["4.20.43", "4.21.40", "4.22.22"]);
    assert.equal(r.json.plan.stagesStale, false);
    assert.deepEqual(r.json.released, [s1]);
    assert.equal(r.json.reused.length, 2);
    assert.deepEqual(r.json.carried.map((c) => [c.stageId, c.release, c.from, c.operators]), [["s1", "4.20.43", "4.20.44", 1]]);
    const all = await profiles();
    const fresh = all.find((x) => x.id === r.json.plan.stages[0].profileId);
    assert.deepEqual(fresh.operators.selected.map((o) => o.name), ["odf-operator"]);
    assert.ok(fresh.operators.selected[0].sources.includes("upgrade:carried-from-4.20.44"));
    const old = all.find((x) => x.id === s1);
    assert.equal(old.ownedBy, undefined);
    assert.equal(old.formerOwner.reason, "route-changed");
    assert.deepEqual(old.operators.selected.map((o) => o.name), ["odf-operator"], "the released profile keeps its own selection");
  });
});

describe("conditional updates", () => {
  test("turning on conditional review never replaces a recommended route", async () => {
    const p = await newPlan();
    await solve(p.id);
    await api("POST", `/api/upgrade/plans/${p.id}`, { conditionalReview: { enabled: true, acknowledgedRisks: [] } });
    const again = await solve(p.id);
    assert.deepEqual(again.path.path, ["4.20.14", "4.20.44", "4.21.40", "4.22.22"]);
    assert.equal(again.path.conditional, false);
  });

  test("a route through a conditional update keeps that release as a stage, with its risks, and acknowledging is recorded as judgment only", async () => {
    const p = await newPlan();
    await api("POST", `/api/upgrade/plans/${p.id}`, { conditionalReview: { enabled: true, acknowledgedRisks: ["PrecisionTimeProtocolDPLLPins"] } });
    const body = fixture("stable-4.22-amd64");
    const idx = (v) => body.nodes.findIndex((n) => n.version === v);
    const has = (a, b) => body.edges.some(([x, y]) => x === idx(a) && y === idx(b));
    const via = body.nodes.map((n) => n.version).filter((v) => v.startsWith("4.21.") && has("4.20.18", v) && has(v, "4.22.22"))[0];
    assert.ok(via, "fixture has a recommended 4.20.18 -> 4.21.x -> 4.22.22 continuation");
    const plan = await solve(p.id, ["4.20.14", "4.20.18", via, "4.22.22"]);
    assert.equal(plan.path.conditional, true);
    assert.equal(plan.path.hops[0].conditional, true);
    assert.deepEqual(plan.path.hops[0].risks.map((x) => x.name), ["PrecisionTimeProtocolDPLLPins"]);
    const staged = (await api("POST", `/api/upgrade/plans/${p.id}/stages`, {})).json.plan;
    assert.deepEqual(staged.stages.map((s) => s.release), ["4.20.18", via, "4.22.22"], "the conditional release is a stage, not dropped");
    assert.equal(staged.stagesStale, false);
    assert.ok(staged.conditionalReview.acknowledgedRisks[0].at, "the acknowledgement is a timestamped administrator judgment");
  });
});
