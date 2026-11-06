/**
 * v2.3.0 P3/P4 — Upgrade stages are Upgrade-owned Mirroring profiles, one
 * pinned release each, executed by the existing Mirroring engine.
 *
 *  - one stage per release the cluster is updated to (not the current one);
 *  - each stage's generated ImageSetConfiguration has exactly one platform
 *    channel with minVersion = maxVersion = the stage release, never
 *    shortestPath/full, and the operator catalog at the stage minor;
 *  - the Mirroring API refuses release/content edits and deletion of a stage;
 *  - stage runs carry the Upgrade owner, are not cancelled by Install Start
 *    Over, pass the server-side preflight contract, and feed stage status;
 *  - deleting a plan keeps stage profiles (ownership released) unless asked,
 *    and never deletes disk data.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

import { app } from "../src/index.js";
import { getJobMetadata } from "../src/utils.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";
import { resetMirroringForTests, resetUpgradeForTests } from "./helpers/resetWorkflowsForTests.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureText = (name) => JSON.stringify(JSON.parse(fs.readFileSync(path.join(here, "fixtures", "upgrade-graph", `${name}.json`), "utf8")).body);
const SECRET = JSON.stringify({ auths: { "registry.redhat.io": { auth: Buffer.from("u:stage-canary-77").toString("base64") } } });

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
const settle = async (id) => {
  for (let i = 0; i < 800; i++) {
    const j = (await api("GET", `/api/jobs/${id}`)).json;
    if (j && !["queued", "running"].includes(j.status)) return j;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`job ${id} did not settle`);
};

before(async () => {
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-stage-stub-"));
  const p = path.join(stubDir, "oc-mirror");
  fs.writeFileSync(p, `#!${process.execPath}
const fs = require("fs"); const path = require("path"); const { spawnSync } = require("child_process");
const args = process.argv.slice(2);
if (args.includes("version")) { console.log(JSON.stringify({ clientVersion: { gitVersion: "4.22.0-stub-stage", gitCommit: "0" } })); }
else {
  const ms = Number(process.env.STUB_SLEEP_MS || 0);
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
  if (ms) setTimeout(finish, ms); else finish();
}
`);
  fs.chmodSync(p, 0o755);
  process.env.OC_MIRROR_BIN = p;
  ({ server, baseUrl } = await createTestServer(app));
  for (const ch of ["stable-4.22", "stable-4.21", "stable-4.20", "fast-4.22"]) {
    const r = await api("POST", "/api/upgrade/graph/import", { channel: ch, arch: "amd64", origin: "snapshot", text: fixtureText(`${ch}-amd64`) });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }
});
after(async () => {
  delete process.env.STUB_SLEEP_MS;
  await resetMirroringForTests();
  await resetUpgradeForTests();
  await closeTestServer(server);
  if (originalBin === undefined) delete process.env.OC_MIRROR_BIN; else process.env.OC_MIRROR_BIN = originalBin;
  fs.rmSync(stubDir, { recursive: true, force: true });
});
beforeEach(async () => {
  delete process.env.STUB_SLEEP_MS;
  await resetMirroringForTests();
  await resetUpgradeForTests();
});

const solvedPlan = async (patch = {}) => {
  const p = (await api("POST", "/api/upgrade/plans", { name: "Prod 4.20 to 4.22" })).json;
  await api("POST", `/api/upgrade/plans/${p.id}`, { arch: "amd64", graphSource: "imported", current: "4.20.14", target: "4.22.22", ...patch });
  const solved = await api("POST", `/api/upgrade/plans/${p.id}/solve`, {});
  assert.equal(solved.status, 200, JSON.stringify(solved.json));
  return solved.json.plan;
};

describe("stage planning", () => {
  test("one Upgrade-owned profile per required release, each with one pinned release per configuration", async () => {
    const plan = await solvedPlan();
    const r = await api("POST", `/api/upgrade/plans/${plan.id}/stages`, {});
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const stages = r.json.plan.stages;
    assert.deepEqual(stages.map((s) => s.release), ["4.20.44", "4.21.40", "4.22.22"], "the current release is not a stage; every intermediate is");
    for (const stage of stages) {
      const preview = await api("POST", `/api/mirroring/profiles/${stage.profileId}/preview`, {});
      assert.equal(preview.status, 200, JSON.stringify(preview.json));
      const doc = yaml.load(preview.json.imagesetConfig);
      assert.equal(doc.apiVersion, "mirror.openshift.io/v2alpha1");
      const channels = doc.mirror.platform.channels;
      assert.equal(channels.length, 1, "exactly one platform channel");
      assert.deepEqual(channels[0], { name: `stable-${stage.minor}`, minVersion: stage.release, maxVersion: stage.release });
      assert.equal("shortestPath" in channels[0] || "full" in channels[0], false);
      assert.deepEqual(doc.mirror.platform.architectures, ["amd64"]);
    }
    const views = r.json.plan.stageViews;
    assert.ok(views.every((v) => v.owned && v.content.state === "planned"));
    const mirroring = (await api("GET", "/api/mirroring")).json;
    const owned = mirroring.profiles.filter((p) => p.ownedBy?.planId === plan.id);
    assert.equal(owned.length, 3);
    assert.equal(owned.filter((p) => p.platform.graph).length, 1, "the graph-data image is mirrored once (first stage)");
    assert.ok(owned.every((p) => p.platform.version.locked && p.operators.catalogMinor === p.platform.release.channel), "locked; catalog minor follows the stage minor");
  });

  test("re-materializing is idempotent; a changed route releases, never rewrites, a stage that left it", async () => {
    const plan = await solvedPlan();
    const first = (await api("POST", `/api/upgrade/plans/${plan.id}/stages`, {})).json;
    const again = (await api("POST", `/api/upgrade/plans/${plan.id}/stages`, {})).json;
    assert.deepEqual(again.plan.stages.map((s) => s.profileId), first.plan.stages.map((s) => s.profileId));
    assert.deepEqual(again.created, []);
    await api("POST", `/api/upgrade/plans/${plan.id}`, { target: "4.21.40" });
    await api("POST", `/api/upgrade/plans/${plan.id}/solve`, {});
    const third = (await api("POST", `/api/upgrade/plans/${plan.id}/stages`, {})).json;
    assert.deepEqual(third.plan.stages.map((s) => s.release), ["4.20.44", "4.21.40"]);
    assert.equal(third.released.length, 1);
    const released = (await api("GET", "/api/mirroring")).json.profiles.find((p) => p.id === third.released[0]);
    assert.equal(released.ownedBy, undefined);
    assert.equal(released.formerOwner.reason, "route-changed");
    assert.equal(released.platform.release.patchVersion, "4.22.22", "its content is untouched");
  });

  test("a fast-only release cannot be staged from stable (refused, not guessed)", async () => {
    const plan = (await api("POST", "/api/upgrade/plans", { name: "fast" })).json;
    // Find a 4.22 release in fast-4.22 that stable-4.22 does not carry yet.
    const fast = (await api("GET", "/api/upgrade/graph?channel=fast-4.22&arch=amd64&source=imported")).json.normalized;
    const stable = (await api("GET", "/api/upgrade/graph?channel=stable-4.22&arch=amd64&source=imported")).json.normalized;
    const fastOnly = fast.versions.filter((v) => !stable.nodes[v] && v.startsWith("4.21."));
    assert.ok(fastOnly.length > 0, "the 2026-11-06 capture has fast-only 4.21 releases (4.21.41)");
    await api("POST", `/api/upgrade/plans/${plan.id}`, { arch: "amd64", graphSource: "imported", channelPolicy: "fast", current: "4.21.40", target: fastOnly[fastOnly.length - 1], planningChannel: "fast-4.22" });
    const solved = await api("POST", `/api/upgrade/plans/${plan.id}/solve`, {});
    assert.equal(solved.status, 200, JSON.stringify(solved.json));
    const r = await api("POST", `/api/upgrade/plans/${plan.id}/stages`, {});
    assert.equal(r.status, 409);
    assert.equal(r.json.code, "STAGE_RELEASE_NOT_IN_STABLE");
  });
});

describe("ownership in the Mirroring workflow", () => {
  test("release and content edits, unlock and delete are refused; operator choices remain editable", async () => {
    const plan = await solvedPlan();
    const stage = (await api("POST", `/api/upgrade/plans/${plan.id}/stages`, {})).json.plan.stages[1];
    for (const [method, url, body] of [
      ["POST", `/api/mirroring/profiles/${stage.profileId}`, { platform: { release: { channel: "4.22", patchVersion: "4.22.1" } } }],
      ["POST", `/api/mirroring/profiles/${stage.profileId}`, { content: { platform: false, operators: true, additionalImages: false } }],
      ["POST", `/api/mirroring/profiles/${stage.profileId}/unlock`, {}],
      ["DELETE", `/api/mirroring/profiles/${stage.profileId}`, undefined]
    ]) {
      const r = await api(method, url, body);
      assert.equal(r.status, 409, `${method} ${url}`);
      assert.equal(r.json.code, "PROFILE_OWNED_BY_UPGRADE");
      assert.equal(r.json.planId, plan.id);
    }
    const rename = await api("POST", `/api/mirroring/profiles/${stage.profileId}`, { name: "renamed stage" });
    assert.equal(rename.status, 200, JSON.stringify(rename.json));
    const withOperators = await api("POST", `/api/mirroring/profiles/${stage.profileId}`, { content: { platform: true, operators: true, additionalImages: false } });
    assert.equal(withOperators.status, 200, "a stage may add operators (catalog at the stage minor)");
    assert.equal(withOperators.json.operators.catalogMinor, stage.minor);
  });
});

describe("stage execution through the existing Mirroring engine", () => {
  test("a stage mirror-to-disk run carries the Upgrade owner and moves the stage to mirrored-to-disk", async () => {
    const plan = await solvedPlan();
    const stage = (await api("POST", `/api/upgrade/plans/${plan.id}/stages`, {})).json.plan.stages[0];
    const run = await api("POST", `/api/mirroring/profiles/${stage.profileId}/run`, { mode: "mirrorToDisk", rhPullSecret: SECRET });
    assert.equal(run.status, 200, JSON.stringify(run.json));
    const job = await settle(run.json.jobId);
    assert.equal(job.status, "completed", job.message);
    const meta = getJobMetadata(run.json.jobId);
    assert.deepEqual(meta.owner, { workflow: "upgrade", planId: plan.id, stageId: "s1" });
    assert.equal(meta.workflow, "mirroring");
    const view = (await api("GET", "/api/upgrade")).json.plans[0].stageViews[0];
    assert.equal(view.content.state, "mirrored-to-disk");
    assert.ok(!JSON.stringify(meta).includes("stage-canary-77"), "no credential in job metadata");
  });

  test("a stage mirror-to-mirror run without destination credentials is refused by the server (N4 holds for Upgrade)", async () => {
    const plan = await solvedPlan();
    const stage = (await api("POST", `/api/upgrade/plans/${plan.id}/stages`, {})).json.plan.stages[0];
    const r = await api("POST", `/api/mirroring/profiles/${stage.profileId}/run`, { mode: "mirrorToMirror", registryUrl: "mirror.example.invalid:8443/ocp", rhPullSecret: SECRET, mirrorAuthSource: "inline", verifyDestination: true });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, "PREFLIGHT_BLOCKED");
  });

  test("Install Start Over neither cancels a running stage nor touches the plan or its stage profiles", async () => {
    const plan = await solvedPlan();
    const stage = (await api("POST", `/api/upgrade/plans/${plan.id}/stages`, {})).json.plan.stages[0];
    process.env.STUB_SLEEP_MS = "4000";
    const run = await api("POST", `/api/mirroring/profiles/${stage.profileId}/run`, { mode: "mirrorToDisk", rhPullSecret: SECRET });
    assert.equal(run.status, 200, JSON.stringify(run.json));
    const preview = (await api("GET", "/api/start-over/preview")).json;
    assert.ok(preview.unaffected.some((j) => j.id === run.json.jobId && j.workflow === "upgrade"));
    assert.equal(preview.preserved.upgradePlans, 1);
    assert.equal(preview.preserved.upgradeStageProfiles, 3);
    const so = await api("POST", "/api/start-over", { cancelInstallRuns: true, previewToken: preview.token });
    assert.equal(so.status, 200, JSON.stringify(so.json));
    assert.equal((await api("GET", `/api/jobs/${run.json.jobId}`)).json.status, "running");
    assert.equal((await api("GET", "/api/upgrade")).json.plans.length, 1);
    await settle(run.json.jobId);
  });
});

describe("plan deletion (layered consent)", () => {
  test("default: the plan record goes, stage profiles stay as ordinary profiles, disk paths are listed and kept", async () => {
    const plan = await solvedPlan();
    const stages = (await api("POST", `/api/upgrade/plans/${plan.id}/stages`, {})).json.plan.stages;
    const preview = (await api("GET", `/api/upgrade/plans/${plan.id}/deletion-preview`)).json;
    assert.equal(preview.stageProfiles.length, 3);
    const del = await api("DELETE", `/api/upgrade/plans/${plan.id}`);
    assert.equal(del.status, 200, JSON.stringify(del.json));
    assert.deepEqual(del.json.releasedStageProfiles.sort(), stages.map((s) => s.profileId).sort());
    assert.deepEqual(del.json.removedStageProfiles, []);
    assert.equal(del.json.retainedPaths.length, 3);
    const profiles = (await api("GET", "/api/mirroring")).json.profiles;
    assert.ok(stages.every((s) => profiles.find((p) => p.id === s.profileId && !p.ownedBy && p.formerOwner?.reason === "plan-deleted")));
  });

  test("explicit: stage profile records are removed too (disk data still kept); refused while a stage runs", async () => {
    const plan = await solvedPlan();
    const stages = (await api("POST", `/api/upgrade/plans/${plan.id}/stages`, {})).json.plan.stages;
    process.env.STUB_SLEEP_MS = "3000";
    const run = await api("POST", `/api/mirroring/profiles/${stages[0].profileId}/run`, { mode: "mirrorToDisk", rhPullSecret: SECRET });
    assert.equal(run.status, 200);
    const refused = await api("DELETE", `/api/upgrade/plans/${plan.id}?removeStageProfiles=true`);
    assert.equal(refused.status, 409);
    assert.equal(refused.json.code, "STAGE_RUNNING");
    await settle(run.json.jobId);
    const del = await api("DELETE", `/api/upgrade/plans/${plan.id}?removeStageProfiles=true`);
    assert.equal(del.status, 200);
    assert.equal(del.json.removedStageProfiles.length, 3);
    assert.equal((await api("GET", "/api/mirroring")).json.profiles.length, 0);
    assert.ok(fs.existsSync(del.json.retainedPaths[0].archivePath), "mirrored data on disk is never deleted by OAA");
  });
});
