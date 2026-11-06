/**
 * v2.3.0 P0b — workflow reset and isolation contract (RFC §18.3).
 *
 * Install, Mirroring and Upgrade are independent. Every Install boundary
 * (autosave, Start Over, run import, export) must leave the other workflows'
 * slices alone, and Install Start Over may cancel only Install's own runs —
 * never a Mirroring or Upgrade job, and never a running job it cannot
 * classify. Temporary files still in use are never swept. The preview the
 * confirmation dialog shows is computed by the same function as the reset.
 *
 * Fail-first: on 617d037 the `upgrade` slice was dropped by Start Over and
 * import, overwritten by autosave and leaked by export; a job tagged
 * `workflow: "upgrade"` was cancelled by Install Start Over; an Install run
 * left running lost its generated config; a tracked in-use temp file was
 * swept; there was no preview.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { app } from "../src/index.js";
import { getState, setState, getJobMetadata, updateJobMetadata } from "../src/utils.js";
import { trackTempArtifact, untrackTempArtifact } from "../src/tempArtifacts.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";
import { resetMirroringForTests } from "./helpers/resetWorkflowsForTests.js";

const DATA_DIR = path.resolve(process.env.DATA_DIR || "/data");
const SECRET = JSON.stringify({ auths: { "registry.redhat.io": { auth: Buffer.from("canary-user:reset-canary-9f3").toString("base64") } } });

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
const jobOf = async (id) => (await api("GET", `/api/jobs/${id}`)).json;
const stop = (id) => api("POST", `/api/jobs/${id}/stop`, {});
const settle = async (id) => {
  for (let i = 0; i < 400; i++) {
    const j = await jobOf(id);
    if (j && !["queued", "running"].includes(j.status)) return j;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`job ${id} did not settle`);
};

const UPGRADE_SLICE = { _schema: "oaa.upgrade.slice/v1", activePlanId: "u-keepme0001", plans: [{ id: "u-keepme0001", name: "keep me", stages: [] }] };
const injectUpgrade = () => setState({ ...getState(), upgrade: JSON.parse(JSON.stringify(UPGRADE_SLICE)) });

const lockInstall = () => api("POST", "/api/state", { version: { versionConfirmed: true }, release: { channel: "stable-4.22", patchVersion: "4.22.16", confirmed: true } });

before(async () => {
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-reset-stub-"));
  const p = path.join(stubDir, "oc-mirror");
  fs.writeFileSync(p, `#!${process.execPath}
const args = process.argv.slice(2);
if (args.includes("version")) { console.log(JSON.stringify({ clientVersion: { gitVersion: "4.22.0-stub-reset", gitCommit: "0" } })); }
else { setTimeout(() => {}, 8000); }
`);
  fs.chmodSync(p, 0o755);
  process.env.OC_MIRROR_BIN = p;
  ({ server, baseUrl } = await createTestServer(app));
});
after(async () => {
  await resetMirroringForTests();
  await api("POST", "/api/start-over", { cancelInstallRuns: true });
  const s = getState(); delete s.upgrade; setState(s);
  await closeTestServer(server);
  if (originalBin === undefined) delete process.env.OC_MIRROR_BIN; else process.env.OC_MIRROR_BIN = originalBin;
  fs.rmSync(stubDir, { recursive: true, force: true });
});
beforeEach(async () => {
  await resetMirroringForTests();
  await api("POST", "/api/start-over", { cancelInstallRuns: true });
});

describe("slices survive every Install boundary", () => {
  test("Install Start Over keeps the Upgrade slice and Mirroring profiles", async () => {
    const p = (await api("POST", "/api/mirroring/profiles", { name: "keep", content: { additionalImages: true }, additionalImages: ["registry.example.invalid/a/b:1"] })).json;
    injectUpgrade();
    const r = await api("POST", "/api/start-over", { cancelInstallRuns: true });
    assert.equal(r.status, 200);
    assert.deepEqual(getState().upgrade, UPGRADE_SLICE);
    assert.equal((await api("GET", "/api/mirroring")).json.profiles.some((x) => x.id === p.id), true);
    assert.equal("upgrade" in r.json, false, "the Install state returned to the browser carries no Upgrade data");
  });

  test("Install autosave with a stale `upgrade` key cannot overwrite the slice", async () => {
    injectUpgrade();
    const r = await api("POST", "/api/state", { upgrade: { plans: [] }, mirroring: { profiles: {} } });
    assert.equal(r.status, 200);
    assert.deepEqual(getState().upgrade, UPGRADE_SLICE);
  });

  test("Install run import neither imports an `upgrade` slice nor drops the current one", async () => {
    injectUpgrade();
    const exported = (await api("GET", "/api/run/export")).json;
    const r = await api("POST", "/api/run/import", { ...exported, state: { ...exported.state, upgrade: { plans: [{ id: "u-intruder001" }] } } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(getState().upgrade, UPGRADE_SLICE);
  });

  test("Install export and GET /api/state never include the Upgrade slice", async () => {
    injectUpgrade();
    assert.equal("upgrade" in (await api("GET", "/api/run/export")).json.state, false);
    assert.equal("upgrade" in (await api("GET", "/api/state")).json, false);
  });
});

describe("Install Start Over cancels only Install runs", () => {
  test("a running job owned by Upgrade (or tagged upgrade) keeps running", async () => {
    const p = (await api("POST", "/api/mirroring/profiles", { name: "stage", content: { additionalImages: true }, additionalImages: ["registry.example.invalid/a/b:1"] })).json;
    const run = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToDisk", rhPullSecret: SECRET });
    assert.equal(run.status, 200, JSON.stringify(run.json));
    const id = run.json.jobId;
    updateJobMetadata(id, { workflow: "upgrade", owner: { workflow: "upgrade", planId: "u-keepme0001", stageId: "s1" } });
    const r = await api("POST", "/api/start-over", { cancelInstallRuns: true });
    assert.equal(r.status, 200);
    assert.equal((await jobOf(id)).status, "running", "an Upgrade job is never cancelled by Install Start Over");
    await stop(id); await settle(id);
  });

  test("an Install run is tagged, cancelled when asked, and listed by the preview exactly as executed", async () => {
    assert.equal((await lockInstall()).status, 200);
    const run = await api("POST", "/api/ocmirror/run", { mode: "mirrorToDisk", archivePath: path.join(DATA_DIR, "reset-install-a") });
    assert.equal(run.status, 200, JSON.stringify(run.json));
    const id = run.json.jobId;
    assert.equal(getJobMetadata(id).workflow, "install", "Install runs carry an explicit workflow tag");
    const preview = await api("GET", "/api/start-over/preview?cancelInstallRuns=true");
    assert.equal(preview.status, 200);
    assert.deepEqual(preview.json.cancel.map((j) => j.id), [id]);
    const r = await api("POST", "/api/start-over", { cancelInstallRuns: true, previewToken: preview.json.token });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal((await settle(id)).status, "cancelled");
  });

  test("an Install run left running keeps its generated configuration (was swept)", async () => {
    assert.equal((await lockInstall()).status, 200);
    const tmp = path.join(DATA_DIR, "tmp");
    fs.mkdirSync(tmp, { recursive: true });
    const beforeFiles = new Set(fs.readdirSync(tmp));
    const run = await api("POST", "/api/ocmirror/run", { mode: "mirrorToDisk", archivePath: path.join(DATA_DIR, "reset-install-b") });
    assert.equal(run.status, 200, JSON.stringify(run.json));
    const id = run.json.jobId;
    try {
      assert.equal((await jobOf(id)).status, "running");
      const created = fs.readdirSync(tmp).filter((f) => !beforeFiles.has(f) && f.endsWith(".yaml"));
      assert.equal(created.length, 1, `the run's generated config is in DATA_DIR/tmp (${created})`);
      const r = await api("POST", "/api/start-over", { cancelInstallRuns: false });
      assert.equal(r.status, 200);
      assert.equal((await jobOf(id)).status, "running");
      assert.ok(fs.existsSync(path.join(tmp, created[0])), "a running Install run's config is not deleted");
    } finally {
      await stop(id); await settle(id);
    }
  });

  test("a running job with no recognised workflow tag is reported, never cancelled", async () => {
    assert.equal((await lockInstall()).status, 200);
    const run = await api("POST", "/api/ocmirror/run", { mode: "mirrorToDisk", archivePath: path.join(DATA_DIR, "reset-install-c") });
    const id = run.json.jobId;
    updateJobMetadata(id, { workflow: "legacy-unknown" });
    const preview = (await api("GET", "/api/start-over/preview?cancelInstallRuns=true")).json;
    assert.equal(run.status, 200, JSON.stringify(run.json));
    assert.ok(preview.unclassified.some((j) => j.id === id));
    assert.equal(preview.cancel.some((j) => j.id === id), false);
    await api("POST", "/api/start-over", { cancelInstallRuns: true });
    assert.equal((await jobOf(id)).status, "running");
    await stop(id); await settle(id);
  });

  test("a scope change between preview and confirmation is refused, and nothing is reset", async () => {
    injectUpgrade();
    const before = (await api("GET", "/api/start-over/preview?cancelInstallRuns=true")).json;
    assert.equal((await lockInstall()).status, 200);
    const run = await api("POST", "/api/ocmirror/run", { mode: "mirrorToDisk", archivePath: path.join(DATA_DIR, "reset-install-d") });
    const r = await api("POST", "/api/start-over", { cancelInstallRuns: true, previewToken: before.token });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, "RESET_SCOPE_CHANGED");
    assert.equal(getState().release?.confirmed, true, "the Install state was not reset");
    assert.equal((await jobOf(run.json.jobId)).status, "running");
    await stop(run.json.jobId); await settle(run.json.jobId);
  });

  test("the preview counts what is kept and contains no credential", async () => {
    injectUpgrade();
    await api("POST", "/api/mirroring/profiles", { name: "k1", content: { additionalImages: true }, additionalImages: ["registry.example.invalid/a/b:1"] });
    const preview = (await api("GET", "/api/start-over/preview")).json;
    assert.equal(preview.preserved.upgradePlans, 1);
    assert.equal(preview.preserved.mirroringProfiles, 1);
    assert.equal(JSON.stringify(preview).includes("reset-canary-9f3"), false);
  });
});

describe("temporary files", () => {
  test("Start Over never deletes a temp file that is still in use; finished leftovers still go", async () => {
    const tmp = path.join(DATA_DIR, "tmp");
    fs.mkdirSync(tmp, { recursive: true });
    const live = path.join(tmp, "registry-auth-live-reset-test.json");
    const stale = path.join(tmp, "leftover-reset-test.yaml");
    fs.writeFileSync(live, "{}", { mode: 0o600 });
    fs.writeFileSync(stale, "x");
    trackTempArtifact(live, "file", "registry-auth");
    try {
      const r = await api("POST", "/api/start-over", { cancelInstallRuns: true });
      assert.equal(r.status, 200);
      assert.ok(fs.existsSync(live), "a tracked (in-use) temp file survives");
      assert.equal(fs.existsSync(stale), false, "an untracked leftover is still cleaned");
    } finally {
      untrackTempArtifact(live);
      fs.rmSync(live, { force: true });
    }
  });
});
