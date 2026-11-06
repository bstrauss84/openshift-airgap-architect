/**
 * v2.3.0 P1 — /api/upgrade through the real HTTP API: plans, offline graph
 * import, dependent target selection, route solving, version boundaries,
 * the disconnected side, isolation from Install, and an unknown slice schema.
 *
 * No network: graphs are imported from recorded fixtures exactly as a
 * disconnected user would import a snapshot or their OSUS graph.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app } from "../src/index.js";
import { getState, setState } from "../src/utils.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";
import { resetUpgradeForTests } from "./helpers/resetWorkflowsForTests.js";

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
const importAll = async () => {
  for (const ch of ["stable-4.22", "stable-4.21", "stable-4.20", "eus-4.22"]) {
    const r = await api("POST", "/api/upgrade/graph/import", { channel: ch, arch: "amd64", origin: "snapshot", text: fixtureText(`${ch}-amd64`), capturedAt: "2026-11-06T16:50:00Z" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }
};

before(async () => {
  ({ server, baseUrl } = await createTestServer(app));
  await importAll();
});
after(async () => {
  await resetUpgradeForTests();
  await closeTestServer(server);
});
beforeEach(async () => {
  delete process.env.AIRGAP_RUNTIME_SIDE;
  await resetUpgradeForTests();
});

const newPlan = async (patch = {}) => {
  const p = (await api("POST", "/api/upgrade/plans", { name: "t" })).json;
  if (Object.keys(patch).length) return (await api("POST", `/api/upgrade/plans/${p.id}`, patch)).json;
  return p;
};

describe("plans and solving", () => {
  test("dependent selection: targets need a current version; the solved route is persisted with its graph sources", async () => {
    let p = await newPlan({ arch: "amd64", graphSource: "imported", currentChannel: "stable-4.20" });
    assert.equal((await api("GET", `/api/upgrade/plans/${p.id}/targets`)).json.code, "CURRENT_REQUIRED");
    p = (await api("POST", `/api/upgrade/plans/${p.id}`, { current: "4.20.14" })).json;
    const targets = await api("GET", `/api/upgrade/plans/${p.id}/targets?channel=stable-4.22`);
    assert.equal(targets.status, 200);
    assert.equal(targets.json.targets.find((t) => t.version === "4.22.22").status, "recommended");
    p = (await api("POST", `/api/upgrade/plans/${p.id}`, { target: "4.22.22" })).json;
    assert.equal(p.planningChannel, "stable-4.22", "the planning channel defaults to the target minor");
    const solved = await api("POST", `/api/upgrade/plans/${p.id}/solve`, {});
    assert.equal(solved.status, 200, JSON.stringify(solved.json));
    assert.deepEqual(solved.json.plan.path.path, ["4.20.14", "4.20.44", "4.21.40", "4.22.22"]);
    assert.deepEqual(solved.json.plan.path.hops.map((h) => h.channelCheck), ["recommended", "recommended", "recommended"]);
    assert.equal(solved.json.plan.path.graphSources[0].origin, "snapshot");
    assert.match(solved.json.plan.path.graphSources[0].bodySha256, /^[a-f0-9]{64}$/);
    assert.equal(solved.json.plan.pathStatus, "as-of", "a snapshot route is never presented as current");
    // A selection change invalidates the route.
    const changed = (await api("POST", `/api/upgrade/plans/${p.id}`, { target: "4.21.40" })).json;
    assert.equal(changed.path, null);
  });

  test("a user-chosen alternative is validated against real edges", async () => {
    const p = await newPlan({ arch: "amd64", graphSource: "imported", current: "4.20.14", target: "4.22.22" });
    const solved = (await api("POST", `/api/upgrade/plans/${p.id}/solve`, {})).json;
    const alt = solved.alternatives[0];
    const chosen = await api("POST", `/api/upgrade/plans/${p.id}/solve`, { route: alt });
    assert.equal(chosen.status, 200, JSON.stringify(chosen.json));
    assert.equal(chosen.json.plan.path.selectedBy, "user");
    const fake = await api("POST", `/api/upgrade/plans/${p.id}/solve`, { route: ["4.20.14", "4.22.22"] });
    assert.equal(fake.status, 409);
    assert.equal(fake.json.code, "ROUTE_MINOR_SKIP");
  });

  test("Control Plane Only plans use eus-4.22 and mark the 4.21 hop", async () => {
    const p = await newPlan({ arch: "amd64", graphSource: "imported", channelPolicy: "eus", strategy: "cpo", current: "4.20.14", target: "4.22.22" });
    assert.equal(p.planningChannel, "eus-4.22");
    const solved = (await api("POST", `/api/upgrade/plans/${p.id}/solve`, {})).json;
    assert.deepEqual(solved.plan.path.hops.map((h) => Boolean(h.controlPlaneOnly)), [false, true, false]);
  });

  test("unsupported versions are refused with 422 and recovery data; nothing is invented", async () => {
    const p = await newPlan();
    for (const patch of [{ current: "4.19.53" }, { target: "4.23.1" }, { planningChannel: "stable-4.23" }, { currentChannel: "eus-4.18" }]) {
      const r = await api("POST", `/api/upgrade/plans/${p.id}`, patch);
      assert.equal(r.status, 422, JSON.stringify(patch));
      assert.equal(r.json.code, "UNSUPPORTED_VERSION");
      assert.deepEqual(r.json.supportedVersions, ["4.20", "4.21", "4.22"]);
    }
    assert.equal((await api("GET", "/api/upgrade/graph?channel=stable-4.23&arch=amd64")).status, 422);
    assert.equal((await api("GET", "/api/upgrade/graph?channel=candidate-4.22&arch=amd64")).status, 400);
  });

  test("a missing graph is reported, not guessed", async () => {
    const p = await newPlan({ arch: "s390x", graphSource: "imported", current: "4.20.14", target: "4.22.22" });
    const r = await api("POST", `/api/upgrade/plans/${p.id}/solve`, {});
    assert.equal(r.status, 409);
    assert.equal(r.json.code, "GRAPH_NOT_LOADED");
  });

  test("the plan limit and plan ids are enforced", async () => {
    assert.equal((await api("POST", "/api/upgrade/plans/not-a-plan", {})).status, 400);
    assert.equal((await api("POST", "/api/upgrade/plans/u-doesnotexist1", {})).status, 404);
    assert.equal((await api("POST", "/api/upgrade/plans", { name: "x", extra: 1 })).status, 400, "strict bodies");
  });
});

describe("boundaries", () => {
  test("the disconnected side never contacts api.openshift.com", async () => {
    process.env.AIRGAP_RUNTIME_SIDE = "high-side";
    const r = await api("POST", "/api/upgrade/graph/refresh", { channel: "stable-4.22", arch: "amd64" });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, "GRAPH_OFFLINE_SIDE");
  });

  test("Install Start Over and Install autosave leave Upgrade plans alone", async () => {
    const p = await newPlan({ current: "4.20.14" });
    await api("POST", "/api/start-over", { cancelInstallRuns: true });
    await api("POST", "/api/state", { upgrade: { _schema: "oaa.upgrade.slice/v1", plans: [] } });
    const after = (await api("GET", "/api/upgrade")).json;
    assert.deepEqual(after.plans.map((x) => x.id), [p.id]);
  });

  test("a slice from a newer Architect blocks Upgrade only and is left untouched", async () => {
    const future = { _schema: "oaa.upgrade.slice/v9", plans: [{ id: "u-futureplan01" }] };
    setState({ ...getState(), upgrade: future });
    try {
      const r = await api("GET", "/api/upgrade");
      assert.equal(r.status, 409);
      assert.equal(r.json.code, "UPGRADE_SCHEMA_UNKNOWN");
      assert.equal((await api("GET", "/api/state")).status, 200, "Install still works");
      assert.equal((await api("GET", "/api/mirroring")).status, 200, "Mirroring still works");
      assert.deepEqual(getState().upgrade, future);
    } finally {
      const s = getState(); delete s.upgrade; setState(s);
    }
  });

  test("no credential-like field is accepted into a plan", async () => {
    const p = await newPlan();
    const r = await api("POST", `/api/upgrade/plans/${p.id}`, { pullSecret: "{\"auths\":{}}" });
    assert.equal(r.status, 400);
  });
});
