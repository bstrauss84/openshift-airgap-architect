/**
 * v2.2.0 Mirroring M6 — low-side transfer, high-side disk to mirror, mirror to
 * mirror and cross-profile isolation, through the real HTTP API.
 *
 * oc-mirror is a Node stub. Mirror to disk writes a REAL tar (working-dir with
 * an isc_pinned file) into its file:// destination, so transfer preparation,
 * verification and staging run against genuine archives; every invocation
 * records its argv and the proxy environment it was given.
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { app } from "../src/index.js";
import { unpinnedCatalogs, stagingSpaceProblem, insideReceivedCopy } from "../src/mirroringTransfer.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";
import { redactCommand, sanitizedLog, TEMP_CREDENTIALS } from "../src/mirroringOperations.js";

const DATA_DIR = path.resolve(process.env.DATA_DIR || "/data");
const CANARY = "c3ludGhldGljOm02LWNhbmFyeQ==";
const PULL_SECRET = JSON.stringify({ auths: { "registry.redhat.io": { auth: CANARY } } });
const MIRROR_SECRET = JSON.stringify({ auths: { "registry.example.invalid:5000": { auth: CANARY } } });
const REGISTRY = "registry.example.invalid:5000/mirror";

let server;
let baseUrl;
let stubDir;
let stubLog;
const originalBin = process.env.OC_MIRROR_BIN;

const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
};
const waitFor = async (predicate, what, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await predicate();
    if (v) return v;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
};
const jobOf = async (id) => (await api("GET", `/api/jobs/${id}`)).json;
const terminal = (id) => waitFor(async () => { const j = await jobOf(id); return j && !["queued", "running"].includes(j.status) ? j : null; }, `job ${id}`);
const metaOf = (job) => (job?.metadata_json ? JSON.parse(job.metadata_json) : {});
/** A successful mirror to disk keeps its archives (and its transfer) in archives/sets/<planId>/. */
const setOf = (job) => { const dir = metaOf(job).archiveSet?.dir; assert.ok(dir, "the run recorded its archive set"); return dir; };
const stubRuns = () => (fs.existsSync(stubLog) ? fs.readFileSync(stubLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const lastRun = () => stubRuns().at(-1);
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");

const installStub = () => {
  const p = path.join(stubDir, "oc-mirror");
  fs.writeFileSync(p, `#!${process.execPath}
const fs = require("fs"); const path = require("path"); const { spawnSync } = require("child_process");
const args = process.argv.slice(2);
const main = () => {
  if (args.includes("version")) { console.log(JSON.stringify({ clientVersion: { gitVersion: "4.22.0-stub-m6", gitCommit: "0000000stubm6" } })); return; }
  const cfg = args[args.indexOf("--config") + 1];
  const dest = args.find((a) => a.startsWith("file://") && args[args.indexOf(a) - 1] !== "--workspace" && args[args.indexOf(a) - 1] !== "--from");
  const from = args.includes("--from") ? args[args.indexOf("--from") + 1] : null;
  fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ args, cfg, cfgSha: fs.existsSync(cfg) ? require("crypto").createHash("sha256").update(fs.readFileSync(cfg)).digest("hex") : null,
    https_proxy: process.env.HTTPS_PROXY || null, no_proxy: process.env.NO_PROXY || null, from }) + "\\n");
  console.log("ARGV: " + args.join(" "));
  if (process.env.STUB_FAIL === "1") { console.log("simulated failure"); process.exitCode = 1; return; }
  const sleep = Number(process.env.STUB_SLEEP_MS || 0);
  const finish = () => {
    if (dest && !args.includes("--dry-run")) {
      // A real oc-mirror archive in miniature: working-dir with the pinned config.
      const dir = dest.replace(/^file:\\/\\//, "");
      fs.mkdirSync(dir, { recursive: true });
      for (const f of fs.readdirSync(dir)) if (/^mirror_.*\\.tar$/.test(f)) fs.unlinkSync(path.join(dir, f));
      const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "stub-wd-"));
      fs.mkdirSync(path.join(tmp, "working-dir"), { recursive: true });
      // Like oc-mirror: catalogs pinned to a digest, unless STUB_UNPINNED=1
      // (the reproduced best-effort pin failure, DOC-155).
      const pinnedCfg = process.env.STUB_UNPINNED === "1" ? fs.readFileSync(cfg, "utf8")
        : fs.readFileSync(cfg, "utf8").replace(/^(\\s*-?\\s*catalog:\\s*)(\\S+?):([\\w][\\w.-]*)\\s*$/gm, (_m, lead, repo) => lead + repo + "@" + (process.env.STUB_CATALOG_DIGEST || "sha256:" + require("crypto").createHash("sha256").update(repo).digest("hex")));
      fs.writeFileSync(path.join(tmp, "working-dir", "isc_pinned_2026-10-27T00:00:00Z.yaml"), pinnedCfg);
      fs.writeFileSync(path.join(tmp, "working-dir", "content-" + Date.now() + ".txt"), "layer data " + Math.random());
      spawnSync("tar", ["-cf", path.join(dir, "mirror_000001.tar"), "-C", tmp, "working-dir"]);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  };
  if (sleep) setTimeout(finish, sleep); else finish();
};
main();
`);
  fs.chmodSync(p, 0o755);
  process.env.OC_MIRROR_BIN = p;
};

const reset = async () => {
  await api("POST", "/api/mirroring/start-over", {});
  await api("POST", "/api/start-over", { cancelRunningOcMirror: true });
};
const CATALOG = (minor) => `registry.redhat.io/redhat/redhat-operator-index:v${minor}`;
const imagesProfile = async (name, images) => (await api("POST", "/api/mirroring/profiles", { name, content: { additionalImages: true }, additionalImages: images })).json;
const operatorsProfile = async (name, minor, pkg) => (await api("POST", "/api/mirroring/profiles", {
  name, content: { operators: true, additionalImages: true }, additionalImages: [`registry.example.invalid/${name}/tool:1`],
  operators: { catalogMinor: minor, catalogMinorSource: "user", selected: [{ id: `${CATALOG(minor)}::${pkg}`, name: pkg, catalog: "redhat", catalogImage: CATALOG(minor), defaultChannel: "stable" }] }
})).json;
const m2d = async (p, extra = {}) => {
  const r = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToDisk", rhPullSecret: PULL_SECRET, ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return terminal(r.json.jobId);
};
const prepare = async (p, jobId) => {
  const r = await api("POST", `/api/mirroring/profiles/${p.id}/transfer`, { jobId });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return terminal(r.json.jobId);
};
const receive = async (transferDir) => {
  const r = await api("POST", "/api/mirroring/receive", { transferDir });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return terminal(r.json.jobId);
};
const profileNow = async (id) => (await api("GET", "/api/mirroring")).json.profiles.find((x) => x.id === id);
/** Copy a prepared transfer (archives, SHA256SUMS, oaa-transfer/) as an operator would onto media. */
const copyTransfer = (archiveDir, name) => {
  const media = path.join(DATA_DIR, "m6-media", `${name}-${crypto.randomBytes(3).toString("hex")}`);
  fs.mkdirSync(path.join(media, "oaa-transfer"), { recursive: true });
  for (const f of fs.readdirSync(archiveDir)) if (/^mirror_\d{6}\.tar$/.test(f) || f === "SHA256SUMS") fs.copyFileSync(path.join(archiveDir, f), path.join(media, f));
  for (const f of fs.readdirSync(path.join(archiveDir, "oaa-transfer"))) fs.copyFileSync(path.join(archiveDir, "oaa-transfer", f), path.join(media, "oaa-transfer", f));
  for (const f of fs.readdirSync(path.join(media, "oaa-transfer"))) fs.chmodSync(path.join(media, "oaa-transfer", f), 0o644);
  return media;
};
/** Content hash of a whole directory tree (names + bytes). */
const treeHash = (dir) => {
  if (!fs.existsSync(dir)) return "absent";
  const h = crypto.createHash("sha256");
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const f = path.join(d, e.name); h.update(path.relative(dir, f)); if (e.isDirectory()) walk(f); else h.update(fs.readFileSync(f)); } };
  walk(dir);
  return h.digest("hex");
};

before(async () => {
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-m6-stub-"));
  stubLog = path.join(stubDir, "runs.jsonl");
  process.env.STUB_LOG = stubLog;
  ({ server, baseUrl } = await createTestServer(app));
});
after(async () => {
  await reset().catch(() => {});
  await closeTestServer(server);
  if (originalBin === undefined) delete process.env.OC_MIRROR_BIN;
  else process.env.OC_MIRROR_BIN = originalBin;
  for (const k of ["STUB_LOG", "STUB_FAIL", "STUB_SLEEP_MS", "AIRGAP_RUNTIME_SIDE"]) delete process.env[k];
  fs.rmSync(stubDir, { recursive: true, force: true });
});
beforeEach(async () => {
  for (const k of ["STUB_FAIL", "STUB_SLEEP_MS"]) delete process.env[k];
  fs.rmSync(stubLog, { force: true });
  installStub();
  await reset();
});

describe("low side: transfer preparation", () => {
  test("a completed mirror to disk becomes a checkable transfer without credentials", async () => {
    const p = await imagesProfile("low", ["registry.example.invalid/a/app:1"]);
    const run = await m2d(p);
    const prep = await prepare(p, run.id);
    assert.equal(prep.status, "completed", prep.message);
    const dir = setOf(run);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "oaa-transfer", "transfer-manifest.json"), "utf8"));
    assert.equal(manifest.schema, "oaa.mirroring.transfer/v1");
    assert.equal(manifest.origin.profileId, p.id);
    assert.equal(manifest.origin.jobId, run.id);
    assert.equal(manifest.origin.planId, metaOf(run).plan.planId);
    assert.equal(manifest.imagesetConfig.sha256, metaOf(run).plan.configSha256);
    assert.equal(manifest.archives[0].file, "mirror_000001.tar");
    assert.equal(manifest.archives[0].containsWorkingDir, true);
    assert.equal(manifest.tool.version, "4.22.0-stub-m6");
    const check = spawnSync("sha256sum", ["-c", "SHA256SUMS"], { cwd: dir, encoding: "utf8" });
    assert.equal(check.status, 0, check.stdout + check.stderr);
    assert.match(fs.readFileSync(path.join(dir, "oaa-transfer", "README-TRANSFER.txt"), "utf8"), /sha256sum -c SHA256SUMS/);
    for (const f of ["transfer-manifest.json", "plan.json", "imageset-config.yaml", "README-TRANSFER.txt"]) {
      assert.equal(fs.readFileSync(path.join(dir, "oaa-transfer", f), "utf8").includes(CANARY), false, `${f} carries no credential`);
    }
    assert.equal((await profileNow(p.id)).transfers.length, 1);
  });

  test("Prepare again replaces the read-only transfer files of the earlier preparation", async () => {
    const p = await imagesProfile("again", ["registry.example.invalid/a/app:1"]);
    const run = await m2d(p);
    assert.equal((await prepare(p, run.id)).status, "completed");
    const sums = path.join(setOf(run), "SHA256SUMS");
    assert.equal(fs.statSync(sums).mode & 0o777, 0o444, "left read-only by the first preparation");
    const again = await prepare(p, run.id);
    assert.equal(again.status, "completed", again.message);
    const check = spawnSync("sha256sum", ["-c", "SHA256SUMS"], { cwd: setOf(run), encoding: "utf8" });
    assert.equal(check.status, 0, "the new checksum list matches the new manifest");
    assert.equal((await receive(setOf(run))).status, "completed");
  });

  test("completed, non-dry-run mirrors to disk keep their own archives and stay transferable; dry and failed runs never are", async () => {
    const p = await imagesProfile("rules", ["registry.example.invalid/a/app:1"]);
    const other = await imagesProfile("other", ["registry.example.invalid/b/app:1"]);
    const dry = await m2d(p, { dryRun: true });
    assert.equal((await api("POST", `/api/mirroring/profiles/${p.id}/transfer`, { jobId: dry.id })).status, 409);
    process.env.STUB_FAIL = "1";
    const failed = await m2d(p);
    delete process.env.STUB_FAIL;
    assert.equal((await api("POST", `/api/mirroring/profiles/${p.id}/transfer`, { jobId: failed.id })).json.code, "NOT_TRANSFERABLE");
    const first = await m2d(p);
    const firstSet = setOf(first);
    const before = treeHash(firstSet);
    const second = await m2d(p);
    assert.notEqual(setOf(second), firstSet);
    assert.equal(treeHash(firstSet), before, "a later run never touches an earlier run's archives (oc-mirror deletes only top-level archives)");
    assert.equal((await prepare(p, first.id)).status, "completed", "the earlier run is still transferable");
    assert.equal((await prepare(p, second.id)).status, "completed");
    assert.equal((await api("POST", `/api/mirroring/profiles/${other.id}/transfer`, { jobId: second.id })).status, 404, "another profile's run");
  });

});

describe("high side: receive and disk to mirror", () => {
  test("same server: the transfer is verified, staged into its own profile and run exactly as recorded, network confined", async () => {
    const p = await imagesProfile("roundtrip", ["registry.example.invalid/a/app:1"]);
    const run = await m2d(p);
    await prepare(p, run.id);
    const recv = await receive(setOf(run));
    assert.equal(recv.status, "completed", recv.message);
    assert.equal(metaOf(recv).profileId, p.id, "attached to the profile it came from");
    const now = await profileNow(p.id);
    const record = now.received[0];
    assert.equal(record.planId, metaOf(run).plan.planId);
    const staged = path.join(p.paths.root, "received", record.planId);
    assert.ok(fs.existsSync(path.join(staged, "mirror_000001.tar")));

    // Edit the profile after the transfer: disk to mirror must not notice.
    await api("POST", `/api/mirroring/profiles/${p.id}`, { additionalImages: ["registry.example.invalid/changed/app:9"] });
    const d2m = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "diskToMirror", registryUrl: REGISTRY, mirrorAuthSource: "inline", mirrorPullSecret: MIRROR_SECRET });
    assert.equal(d2m.status, 200, JSON.stringify(d2m.json));
    const job = await terminal(d2m.json.jobId);
    assert.equal(job.status, "completed");
    const call = lastRun();
    assert.equal(call.cfg, path.join(staged, "oaa-transfer", "imageset-config.yaml"));
    assert.equal(call.cfgSha, metaOf(run).plan.configSha256, "the low-side configuration, byte for byte");
    assert.equal(call.from, `file://${staged}`);
    assert.ok(call.args.includes(`docker://${REGISTRY}`));
    assert.ok(call.args.includes("--cache-dir") && call.args[call.args.indexOf("--cache-dir") + 1] === p.paths.cachePath);
    assert.equal(call.https_proxy, "http://127.0.0.1:9", "everything but the destination goes nowhere");
    assert.match(call.no_proxy, /registry\.example\.invalid/);
    assert.equal(metaOf(job).plan.kind, "received");
    assert.equal(metaOf(job).plan.planId, record.planId);
    assert.equal(fs.readFileSync(call.cfg, "utf8").includes("changed/app"), false, "never regenerated from the edited profile");
    assert.equal(JSON.stringify(await jobOf(d2m.json.jobId)).includes(CANARY), false);

    const open = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "diskToMirror", registryUrl: REGISTRY, mirrorAuthSource: "inline", mirrorPullSecret: MIRROR_SECRET, isolateNetwork: false });
    await terminal(open.json.jobId);
    assert.equal(lastRun().https_proxy, null, "confinement can be switched off explicitly");
  });

  test("another server: a received profile is created, read-only, and runs only disk to mirror", async () => {
    const p = await operatorsProfile("ops-low", "4.22", "demo-op");
    const run = await m2d(p);
    await prepare(p, run.id);
    const media = copyTransfer(setOf(run), "elsewhere");
    await api("DELETE", `/api/mirroring/profiles/${p.id}`); // the high side does not know the low-side profile
    const recv = await receive(media);
    assert.equal(recv.status, "completed", recv.message);
    const target = await profileNow(metaOf(recv).profileId);
    assert.equal(target.kind, "received");
    assert.equal(target.origin.profileId, p.id);
    assert.match(target.name, /^Received: ops-low/);
    assert.equal((await api("POST", `/api/mirroring/profiles/${target.id}`, { additionalImages: ["x.example/y:1"] })).json.code, "RECEIVED_PROFILE_READ_ONLY");
    assert.equal((await api("POST", `/api/mirroring/profiles/${target.id}`, { name: "Site B" })).status, 200, "the name may change");
    for (const mode of ["mirrorToDisk", "mirrorToMirror"]) {
      assert.equal((await api("POST", `/api/mirroring/profiles/${target.id}/run`, { mode, registryUrl: REGISTRY, rhPullSecret: PULL_SECRET })).status, 409);
    }
    const preview = await api("POST", `/api/mirroring/profiles/${target.id}/preview`, {});
    assert.equal(sha256(preview.json.imagesetConfig), metaOf(run).plan.configSha256);
    assert.match(preview.json.imagesetConfig, /redhat-operator-index:v4\.22/, "catalog references as recorded");
    const pf = await api("POST", `/api/mirroring/profiles/${target.id}/preflight`, { mode: "diskToMirror", registryUrl: REGISTRY, mirrorAuthSource: "inline", mirrorPullSecret: MIRROR_SECRET });
    const byId = Object.fromEntries(pf.json.items.map((i) => [i.id, i]));
    assert.equal(byId.received.status, "pass");
    assert.equal(byId.network.status, "pass");
    assert.equal(pf.json.ok, true, JSON.stringify(pf.json.blockers));
    const d2m = await api("POST", `/api/mirroring/profiles/${target.id}/run`, { mode: "diskToMirror", registryUrl: REGISTRY, mirrorAuthSource: "inline", mirrorPullSecret: MIRROR_SECRET });
    assert.equal((await terminal(d2m.json.jobId)).status, "completed");
  });

  test("a staged copy that changes after receipt blocks disk to mirror", async () => {
    const p = await imagesProfile("tamper-staged", ["registry.example.invalid/a/app:1"]);
    const run = await m2d(p);
    await prepare(p, run.id);
    await receive(setOf(run));
    const record = (await profileNow(p.id)).received[0];
    fs.appendFileSync(path.join(p.paths.root, "received", record.planId, "mirror_000001.tar"), "x");
    const pf = await api("POST", `/api/mirroring/profiles/${p.id}/preflight`, { mode: "diskToMirror", registryUrl: REGISTRY, mirrorAuthSource: "inline", mirrorPullSecret: MIRROR_SECRET });
    assert.equal(pf.json.items.find((i) => i.id === "received").status, "block");
    const d2m = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "diskToMirror", registryUrl: REGISTRY, mirrorAuthSource: "inline", mirrorPullSecret: MIRROR_SECRET });
    assert.equal(d2m.json.code, "TRANSFER_CHANGED");
  });
});

describe("receive never harms a copy it already holds, and checks space first", () => {
  test("naming an already-received copy as the transfer folder is refused and the copy stays intact", async () => {
    const p = await imagesProfile("self", ["registry.example.invalid/a/app:1"]);
    const run = await m2d(p);
    await prepare(p, run.id);
    assert.equal((await receive(setOf(run))).status, "completed");
    const staged = path.join(p.paths.root, "received", metaOf(run).plan.planId);
    const before = treeHash(staged);
    for (const dir of [staged, path.join(staged, "oaa-transfer")]) {
      const r = await api("POST", "/api/mirroring/receive", { transferDir: dir });
      assert.equal(r.status, 400, dir);
      assert.equal(r.json.code, "TRANSFER_DIR_IS_RECEIVED_COPY");
    }
    assert.equal(treeHash(staged), before, "the received copy is untouched");
    const d2m = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "diskToMirror", registryUrl: REGISTRY, mirrorAuthSource: "inline", mirrorPullSecret: MIRROR_SECRET });
    assert.equal(d2m.status, 200, "still usable for disk to mirror");
    await terminal(d2m.json.jobId);
  });

  test("the received tree is recognised only inside a profile's received directory", () => {
    const root = "/data/oc-mirror/profiles";
    assert.equal(insideReceivedCopy(`${root}/p-abc12345/received/plan-x`, root), true);
    assert.equal(insideReceivedCopy(`${root}/p-abc12345/received`, root), true);
    assert.equal(insideReceivedCopy(`${root}/p-abc12345/archives`, root), false);
    assert.equal(insideReceivedCopy("/data/transfer/site-a", root), false);
    assert.equal(insideReceivedCopy(root, root), false);
  });

  test("too little free space refuses before anything is copied; an earlier copy of the same plan counts as free", () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-space-"));
    const verified = { manifest: { archives: [{ file: "mirror_000001.tar", bytes: 10 * 1024 ** 3 }] } };
    const statfs = () => ({ bavail: 1024, bsize: 1024 * 1024 }); // 1 GiB free
    const msg = stagingSpaceProblem(path.join(dest, "received", "plan-new"), verified, { statfs });
    assert.match(msg, /needs 10\.00 GiB and 1\.00 GiB is free/);
    assert.equal(stagingSpaceProblem(path.join(dest, "x"), verified, { statfs: () => ({ bavail: 11 * 1024, bsize: 1024 * 1024 }) }), null);
    // Replacing a same-sized earlier copy needs no extra room.
    fs.writeFileSync(path.join(dest, "mirror_000001.tar"), "");
    fs.truncateSync(path.join(dest, "mirror_000001.tar"), 10 * 1024 ** 3);
    assert.equal(stagingSpaceProblem(dest, verified, { statfs: () => ({ bavail: 8, bsize: 1024 * 1024 }) }), null);
    fs.rmSync(dest, { recursive: true, force: true });
  });
});

describe("transfer order on the disconnected side", () => {
  test("loading an older transfer after a newer one is refused before oc-mirror runs (it would roll the catalogs back and exit 0)", async () => {
    const p = await imagesProfile("cycles", ["registry.example.invalid/a/app:1"]);
    const first = await m2d(p);
    await prepare(p, first.id);
    const media1 = copyTransfer(setOf(first), "cycle1");
    const second = await m2d(p);
    await prepare(p, second.id);
    const media2 = copyTransfer(setOf(second), "cycle2");
    assert.equal((await receive(media1)).status, "completed");
    assert.equal((await receive(media2)).status, "completed");
    const older = metaOf(first).plan.planId;
    const newer = metaOf(second).plan.planId;
    const d2mBody = { mode: "diskToMirror", registryUrl: REGISTRY, mirrorAuthSource: "inline", mirrorPullSecret: MIRROR_SECRET };
    const pre0 = await api("POST", `/api/mirroring/profiles/${p.id}/preflight`, { ...d2mBody, receivedPlanId: older });
    assert.equal(pre0.json.items.find((i) => i.id === "transfer-order").status, "pass", "nothing loaded yet: a first, full transfer");
    const run = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { ...d2mBody, receivedPlanId: newer });
    assert.equal((await terminal(run.json.jobId)).status, "completed");
    const pre = await api("POST", `/api/mirroring/profiles/${p.id}/preflight`, { ...d2mBody, receivedPlanId: older });
    const item = pre.json.items.find((i) => i.id === "transfer-order");
    assert.equal(item.status, "block");
    assert.match(item.detail, /roll its operator catalogs back/);
    assert.equal(pre.json.ok, false);
    const refused = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { ...d2mBody, receivedPlanId: older });
    assert.equal(refused.status, 409);
    assert.equal(refused.json.code, "TRANSFER_ROLLBACK");
    const again = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { ...d2mBody, receivedPlanId: newer });
    assert.equal(again.status, 200, "the same transfer again is fine");
    await terminal(again.json.jobId);
    const elsewhere = await api("POST", `/api/mirroring/profiles/${p.id}/preflight`, { ...d2mBody, registryUrl: "other.example.invalid:5000/m", receivedPlanId: older });
    assert.equal(elsewhere.json.items.find((i) => i.id === "transfer-order").status, "pass", "order is per destination registry");
  });
});

describe("Mirroring operations: one view over the job engine", () => {
  test("runs, transfer, receipt and disk to mirror are listed, identified, linked and free of credentials", async () => {
    const p = await imagesProfile("ops", ["registry.example.invalid/a/app:1"]);
    const run = await m2d(p);
    const prep = await prepare(p, run.id);
    const recv = await receive(setOf(run));
    const d2mStart = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "diskToMirror", registryUrl: REGISTRY, mirrorAuthSource: "inline", mirrorPullSecret: MIRROR_SECRET });
    const d2m = await terminal(d2mStart.json.jobId);
    const list = await api("GET", "/api/mirroring/operations");
    assert.equal(list.status, 200);
    assert.equal(JSON.stringify(list.json).includes(CANARY), false, "no credential in the list");
    assert.equal(JSON.stringify(list.json).includes("registry-auth-"), false, "no temporary credential path");
    const ops = list.json.operations;
    const byId = Object.fromEntries(ops.map((o) => [o.jobId, o]));
    assert.deepEqual([d2m.id, recv.id, prep.id, run.id].every((id) => byId[id]), true);
    assert.ok(ops.findIndex((o) => o.jobId === d2m.id) < ops.findIndex((o) => o.jobId === run.id), "newest first");
    const m = byId[run.id];
    assert.equal(m.kind, "run");
    assert.equal(m.mode, "mirrorToDisk");
    assert.equal(m.profileName, "ops");
    assert.equal(m.destination, p.paths.archivePath);
    assert.equal(m.tool.version, "4.22.0-stub-m6");
    assert.match(m.tool.sha256, /^[a-f0-9]{64}$/);
    assert.ok(m.command.includes("--v2") && m.command.includes(`file://${p.paths.archivePath}`));
    assert.ok(m.command.includes(`--authfile ${TEMP_CREDENTIALS}`), m.command);
    assert.equal(m.plan.planId, metaOf(run).plan.planId);
    assert.deepEqual(m.links.map((l) => l.jobId).sort(), [prep.id, recv.id].sort(), "mirror to disk → its transfer and its receipt");
    assert.equal(byId[prep.id].kind, "transfer");
    assert.equal(byId[prep.id].links.find((l) => l.jobId === run.id).label, "Mirror to disk it was prepared from");
    const r = byId[recv.id];
    assert.equal(r.kind, "receive");
    assert.ok(r.links.some((l) => l.jobId === run.id) && r.links.some((l) => l.jobId === d2m.id) && r.links.some((l) => l.jobId === prep.id));
    const d = byId[d2m.id];
    assert.equal(d.mode, "diskToMirror");
    assert.equal(d.plan.kind, "received");
    assert.equal(d.plan.networkConfined, true);
    assert.equal(d.destination, `docker://${REGISTRY}`);
    assert.match(d.source, /^Received transfer plan-/);
    assert.equal(d.tool.version, "4.22.0-stub-m6", "the binary that ran disk to mirror is recorded too");
    assert.equal(d.contentSummary, "1 additional image(s)");
    assert.ok(d.links.some((l) => l.jobId === recv.id && l.label === "Receipt that staged this transfer"));

    const one = await api("GET", `/api/mirroring/operations/${run.id}`);
    assert.equal(one.json.operation.contentSummary, "1 additional image(s)");
    assert.equal(one.json.operation.planReadable, true);
    assert.equal(one.json.operation.links.length, 2);
    assert.equal((await api("GET", "/api/mirroring/operations/not-a-job")).status, 404);
  });

  test("the log downloads as sanitized text with a header naming the run", async () => {
    const p = await imagesProfile("ops-log", ["registry.example.invalid/a/app:1"]);
    const run = await m2d(p);
    const res = await fetch(`${baseUrl}/api/mirroring/operations/${run.id}/log`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /^text\/plain/);
    assert.match(res.headers.get("content-disposition"), /^attachment; filename="mirroring-run-.*\.log"$/);
    const text = await res.text();
    assert.match(text, /^# OpenShift Airgap Architect — Mirroring operation log/);
    assert.match(text, /# Operation: Mirror to disk/);
    assert.match(text, /# Profile: ops-log/);
    assert.match(text, /# oc-mirror: 4\.22\.0-stub-m6 · SHA-256 [a-f0-9]{64}/);
    assert.match(text, /ARGV: --config /, "the real output follows the header");
    assert.equal(text.includes("registry-auth-"), false);
    assert.equal(text.includes(CANARY), false);
  });

  test("command and log redaction", () => {
    assert.equal(redactCommand("/x/oc-mirror --config c.yaml --v2 --authfile /data/tmp/registry-auth-AbC_12.json file:///a"), `/x/oc-mirror --config c.yaml --v2 --authfile ${TEMP_CREDENTIALS} file:///a`);
    assert.equal(redactCommand(null), null);
    const log = sanitizedLog({ output: "\x1b[32minfo\x1b[0m copied\rprogress 2/2\nauth file /data/tmp/registry-auth-zz9.json\n" }, { jobId: "j1", kind: "run", status: "completed" });
    assert.equal(log.includes("\x1b["), false, "colour codes removed");
    assert.match(log, /info copied\nprogress 2\/2/);
    assert.ok(log.includes(TEMP_CREDENTIALS) && !log.includes("registry-auth-zz9"));
  });
});

describe("transfer verification refuses missing, altered, incomplete and mismatched data", () => {
  let base;
  beforeEach(async () => {
    const p = await imagesProfile("verify", ["registry.example.invalid/a/app:1"]);
    const run = await m2d(p);
    await prepare(p, run.id);
    base = copyTransfer(setOf(run), "base");
  });
  const variant = (name, mutate) => {
    const dir = path.join(path.dirname(base), `${name}-${crypto.randomBytes(3).toString("hex")}`);
    fs.cpSync(base, dir, { recursive: true });
    mutate(dir);
    return dir;
  };
  const expectFailure = async (dir, re) => {
    const j = await receive(dir);
    assert.equal(j.status, "failed", `${dir}: ${j.message}`);
    assert.match(`${j.message}\n${j.output || ""}`, re);
    return j;
  };

  test("the untouched copy is received", async () => {
    assert.equal((await receive(base)).status, "completed");
  });
  test("an altered archive", async () => {
    await expectFailure(variant("altered", (d) => { const f = path.join(d, "mirror_000001.tar"); const b = fs.readFileSync(f); b[600] ^= 0xff; fs.writeFileSync(f, b); }), /does not match its recorded SHA-256/);
  });
  test("a missing archive, with recovery guidance", async () => {
    const j = await expectFailure(variant("missing", (d) => fs.unlinkSync(path.join(d, "mirror_000001.tar"))), /mirror_000001\.tar is missing/);
    assert.match(j.output, /TO FIX: Copy the missing archive/);
  });
  test("an interrupted (short) copy", async () => {
    await expectFailure(variant("short", (d) => { const f = path.join(d, "mirror_000001.tar"); fs.truncateSync(f, fs.statSync(f).size - 512); }), /incomplete copy/);
  });
  test("an archive from another run mixed in", async () => {
    await expectFailure(variant("extra", (d) => fs.copyFileSync(path.join(d, "mirror_000001.tar"), path.join(d, "mirror_000002.tar"))), /not in this transfer/);
  });
  test("an edited configuration", async () => {
    await expectFailure(variant("config", (d) => fs.appendFileSync(path.join(d, "oaa-transfer", "imageset-config.yaml"), "# edited\n")), /imageset-config\.yaml does not match/);
  });
  test("an edited plan", async () => {
    await expectFailure(variant("plan", (d) => fs.appendFileSync(path.join(d, "oaa-transfer", "plan.json"), " ")), /plan\.json does not match/);
  });
  test("a missing plan.json is named, with recovery, and no server path is shown", async () => {
    const r = await expectFailure(variant("no-plan", (d) => fs.rmSync(path.join(d, "oaa-transfer", "plan.json"))), /oaa-transfer\/plan\.json is missing\./);
    assert.doesNotMatch(JSON.stringify(r ?? ""), /ENOENT|lstat/);
  });
  test("no manifest", async () => {
    await expectFailure(variant("nomanifest", (d) => fs.unlinkSync(path.join(d, "oaa-transfer", "transfer-manifest.json"))), /No readable transfer manifest/);
  });
  test("a manifest naming a path outside the transfer", async () => {
    await expectFailure(variant("traversal", (d) => {
      const f = path.join(d, "oaa-transfer", "transfer-manifest.json");
      const m = JSON.parse(fs.readFileSync(f, "utf8"));
      m.archives[0].file = "../../../etc/passwd";
      fs.writeFileSync(f, JSON.stringify(m));
    }), /unexpected name/);
  });
  test("a symlinked archive", async () => {
    await expectFailure(variant("symlink", (d) => {
      const f = path.join(d, "mirror_000001.tar");
      fs.renameSync(f, path.join(d, "real.bin"));
      fs.symlinkSync(path.join(d, "real.bin"), f);
    }), /not a plain file/);
  });
  test("an archive whose entries escape the extraction directory", async () => {
    await expectFailure(variant("evil-tar", (d) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "evil-"));
      fs.mkdirSync(path.join(tmp, "a"));
      fs.writeFileSync(path.join(tmp, "x"), "x");
      spawnSync("tar", ["-cf", path.join(d, "mirror_000001.tar"), "-C", path.join(tmp, "a"), "--transform", "s,^,../,", "../x"]);
      const tarFile = path.join(d, "mirror_000001.tar");
      // Re-record the hash so only the entry check can catch it.
      const f = path.join(d, "oaa-transfer", "transfer-manifest.json");
      const m = JSON.parse(fs.readFileSync(f, "utf8"));
      m.archives[0].sha256 = sha256(fs.readFileSync(tarFile));
      m.archives[0].bytes = fs.statSync(tarFile).size;
      fs.writeFileSync(f, JSON.stringify(m));
      fs.rmSync(tmp, { recursive: true, force: true });
    }), /unsafe entry name/);
  });
  test("a directory outside the server's allowed roots", async () => {
    const r = await api("POST", "/api/mirroring/receive", { transferDir: "/etc" });
    assert.equal(r.status, 400);
    assert.equal(r.json.code, "TRANSFER_DIR_INVALID");
  });
  test("a consistent transfer of an unsupported OpenShift minor is refused (No Fallback)", async () => {
    await expectFailure(variant("unsupported", (d) => {
      const pf = path.join(d, "oaa-transfer", "plan.json");
      const plan = JSON.parse(fs.readFileSync(pf, "utf8"));
      plan.content.platform = { release: "4.23.1" };
      const planBytes = Buffer.from(JSON.stringify(plan));
      fs.writeFileSync(pf, planBytes);
      const mf = path.join(d, "oaa-transfer", "transfer-manifest.json");
      const m = JSON.parse(fs.readFileSync(mf, "utf8"));
      m.plan.sha256 = sha256(planBytes);
      m.origin.planSha256 = m.plan.sha256;
      fs.writeFileSync(mf, JSON.stringify(m));
    }), /4\.23 is not supported|not supported/i);
  });
});

describe("mirror to mirror", () => {
  test("runs with the profile's own workspace and cache and records a plan", async () => {
    const p = await imagesProfile("m2m", ["registry.example.invalid/a/app:1"]);
    const r = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToMirror", registryUrl: REGISTRY, rhPullSecret: PULL_SECRET, mirrorAuthSource: "inline", mirrorPullSecret: MIRROR_SECRET });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const job = await terminal(r.json.jobId);
    const call = lastRun();
    assert.equal(call.args[call.args.indexOf("--workspace") + 1], `file://${p.paths.workspacePath}`);
    assert.equal(call.args[call.args.indexOf("--cache-dir") + 1], p.paths.cachePath);
    assert.equal(call.args.at(-1), `docker://${REGISTRY}`);
    assert.equal(call.https_proxy, null, "mirror to mirror needs the source registries");
    const plan = JSON.parse(fs.readFileSync(path.join(p.paths.root, "plans", metaOf(job).plan.planId, "plan.json"), "utf8"));
    assert.equal(plan.workflow.mode, "mirrorToMirror");
    const pf = await api("POST", `/api/mirroring/profiles/${p.id}/preflight`, { mode: "mirrorToMirror", registryUrl: REGISTRY, rhPullSecret: PULL_SECRET, mirrorAuthSource: "inline", mirrorPullSecret: MIRROR_SECRET });
    assert.ok(pf.json.items.some((i) => i.id === "workspace-history"));
    assert.equal(pf.json.ok, true, JSON.stringify(pf.json.blockers));
  });
});

describe("cross-profile isolation", () => {
  test("two profiles with different content and catalog minors never read, reuse or alter each other's state", async () => {
    const a = await operatorsProfile("site-a", "4.21", "alpha-op");
    const b = await operatorsProfile("site-b", "4.22", "beta-op");

    // A: two incremental runs, a transfer, received into A.
    const a1 = await m2d(a);
    const a2 = await m2d(a);
    await prepare(a, a2.id);
    await receive(setOf(a2));
    const snapshotA = () => ({
      root: treeHash(a.paths.root),
      history: [...(stateOf(a.id).history || [])]
    });
    let stateCache = null;
    const stateOf = (id) => stateCache.find((x) => x.id === id);
    stateCache = (await api("GET", "/api/mirroring")).json.profiles;
    const before = snapshotA();

    // B: a failed run, a cancelled run, then a resumed run, a transfer and its receipt.
    process.env.STUB_FAIL = "1";
    assert.equal((await m2d(b)).status, "failed");
    delete process.env.STUB_FAIL;
    process.env.STUB_SLEEP_MS = "3000";
    const slow = await api("POST", `/api/mirroring/profiles/${b.id}/run`, { mode: "mirrorToDisk", rhPullSecret: PULL_SECRET });
    await waitFor(async () => (await jobOf(slow.json.jobId))?.status === "running", "b's run");
    // The global one-run guard holds across profiles.
    const blocked = await api("POST", `/api/mirroring/profiles/${a.id}/run`, { mode: "mirrorToDisk", rhPullSecret: PULL_SECRET });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.json.code, "OC_MIRROR_RUN_IN_PROGRESS");
    await api("POST", `/api/jobs/${slow.json.jobId}/stop`, {});
    assert.equal((await terminal(slow.json.jobId)).status, "cancelled");
    delete process.env.STUB_SLEEP_MS;
    const b3 = await m2d(b);
    assert.equal(b3.status, "completed");
    await prepare(b, b3.id);
    await receive(setOf(b3));

    // B cannot run A's received plan, nor transfer A's run.
    const aRecord = (await profileNow(a.id)).received[0];
    const cross = await api("POST", `/api/mirroring/profiles/${b.id}/run`, { mode: "diskToMirror", receivedPlanId: aRecord.planId, registryUrl: REGISTRY, mirrorAuthSource: "inline", mirrorPullSecret: MIRROR_SECRET });
    assert.equal(cross.json.code, "TRANSFER_NOT_RECEIVED");
    assert.equal((await api("POST", `/api/mirroring/profiles/${b.id}/transfer`, { jobId: a2.id })).status, 404);

    // A's whole directory tree and history are exactly as before.
    stateCache = (await api("GET", "/api/mirroring")).json.profiles;
    assert.deepEqual(snapshotA(), before);
    const bNow = stateOf(b.id);
    assert.equal(bNow.history.some((h) => [a1.id, a2.id].includes(h)), false);
    // Each profile's plans name its own catalog minor; each command used its own paths.
    const planCfg = (p, job) => fs.readFileSync(path.join(p.paths.root, "plans", metaOf(job).plan.planId, "imageset-config.yaml"), "utf8");
    assert.match(planCfg(a, a2), /redhat-operator-index:v4\.21/);
    assert.doesNotMatch(planCfg(a, a2), /v4\.22/);
    assert.match(planCfg(b, b3), /redhat-operator-index:v4\.22/);
    for (const call of stubRuns()) {
      const own = call.args.some((x) => x.includes(b.id)) ? b : a;
      const theirs = own === a ? b : a;
      assert.equal(call.args.some((x) => x.includes(theirs.id)), false, `a command for ${own.name} touched ${theirs.name}'s paths: ${call.args.join(" ")}`);
    }
    // B's received transfer is B's.
    assert.equal(bNow.received[0].origin.profileId, b.id);
  });
});

describe("F23 and the high-side runtime", () => {
  test("--since must be yyyy-MM-dd in the shared preflight", async () => {
    const p = await imagesProfile("since", ["registry.example.invalid/a/app:1"]);
    const pf = await api("POST", `/api/mirroring/profiles/${p.id}/preflight`, { mode: "mirrorToDisk", advanced: { since: "2026-01-31T10:00:00Z" } });
    assert.match(pf.json.blockers.join(" "), /yyyy-MM-dd/);
    assert.equal(pf.json.items.find((i) => i.id === "options").status, "block");
  });
  test("AIRGAP_RUNTIME_SIDE=high-side: no update check request", async () => {
    process.env.AIRGAP_RUNTIME_SIDE = "high-side";
    try {
      const { clearUpdateInfoCache } = await import("../src/index.js");
      clearUpdateInfoCache();
      const info = (await api("GET", "/api/update-info")).json;
      assert.equal(info.enabled, false);
    } finally {
      delete process.env.AIRGAP_RUNTIME_SIDE;
    }
  });
});

describe("DOC-155: catalogs left unpinned by oc-mirror", () => {
  test("only digest-pinned catalog references count as pinned", () => {
    const digest = `registry.redhat.io/redhat/redhat-operator-index@sha256:${"a".repeat(64)}`;
    assert.deepEqual(unpinnedCatalogs([{ catalog: digest }, { catalog: "registry.redhat.io/redhat/certified-operator-index:v4.22" }]), ["registry.redhat.io/redhat/certified-operator-index:v4.22"]);
    assert.deepEqual(unpinnedCatalogs([{ catalog: digest }]), []);
    assert.deepEqual(unpinnedCatalogs(null), []);
  });
});

describe("DOC-155: catalog identity and offline readiness of a transfer", () => {
  beforeEach(reset);
  test("pinned catalogs: offline-ready, and the high side's preflight says so", async () => {
    const p = await operatorsProfile("pinned", "4.22", "alpha-op");
    const run = await m2d(p);
    const prep = await prepare(p, run.id);
    assert.equal(prep.status, "completed", prep.message);
    const manifest = JSON.parse(fs.readFileSync(path.join(setOf(run), "oaa-transfer", "transfer-manifest.json"), "utf8"));
    assert.equal(manifest.offlineReady, true);
    assert.equal(manifest.catalogIdentity.length, 1);
    assert.equal(manifest.catalogIdentity[0].sourceReference, CATALOG("4.22"));
    assert.match(manifest.catalogIdentity[0].pinnedDigest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(manifest.catalogIdentity[0].status, "not-verified", "the operators were never checked, so nothing to compare");
    assert.match(fs.readFileSync(path.join(setOf(run), "oaa-transfer", "README-TRANSFER.txt"), "utf8"), /Offline-ready: every catalog is pinned/);
  });

  test("an unpinned catalog blocks Prepare transfer until the user accepts a not-offline-ready transfer", async () => {
    const p = await operatorsProfile("unpinned", "4.22", "alpha-op");
    process.env.STUB_UNPINNED = "1";
    let run;
    try { run = await m2d(p); } finally { delete process.env.STUB_UNPINNED; }
    const refused = await prepare(p, run.id);
    assert.equal(refused.status, "failed");
    assert.equal(metaOf(refused).code, "CATALOG_NOT_PINNED");
    assert.deepEqual(metaOf(refused).unpinnedCatalogs, [CATALOG("4.22")]);
    assert.equal(fs.existsSync(path.join(setOf(run), "oaa-transfer")), false, "nothing written when refused");

    const r = await api("POST", `/api/mirroring/profiles/${p.id}/transfer`, { jobId: run.id, acknowledgeUnpinned: true });
    assert.equal(r.status, 200);
    const accepted = await terminal(r.json.jobId);
    assert.equal(accepted.status, "completed_with_warnings");
    assert.match(accepted.message, /NOT offline-ready/);
    const manifest = JSON.parse(fs.readFileSync(path.join(setOf(run), "oaa-transfer", "transfer-manifest.json"), "utf8"));
    assert.equal(manifest.offlineReady, false);
    assert.equal(manifest.notOfflineReadyAcknowledged, true);
    assert.match(fs.readFileSync(path.join(setOf(run), "oaa-transfer", "README-TRANSFER.txt"), "utf8"), /NOT OFFLINE-READY/);

    // Carried to "another server": the received profile's preflight warns.
    const media = copyTransfer(setOf(run), "unpinned");
    await api("DELETE", `/api/mirroring/profiles/${p.id}`);
    const rec = await receive(media);
    assert.equal(rec.status, "completed", rec.message);
    const received = await profileNow(metaOf(rec).profileId);
    assert.equal(received.received[0].offlineReady, false);
    const pf = await api("POST", `/api/mirroring/profiles/${received.id}/preflight`, { mode: "diskToMirror", registryUrl: REGISTRY, mirrorAuthSource: "inline", mirrorPullSecret: MIRROR_SECRET });
    const item = pf.json.items.find((i) => i.id === "catalog-identity");
    assert.equal(item.status, "warn");
    assert.match(item.detail, /Not offline-ready/);
  });

  test("identity report: matches, differs, not verified, unpinned", async () => {
    const { catalogIdentityReport } = await import("../src/mirroringTransfer.js");
    const D = (c) => `sha256:${c.repeat(64)}`;
    const plan = { content: { operators: {
      catalogs: [{ catalog: "r.io/a/idx:v4.22" }, { catalog: "r.io/b/idx:v4.22" }, { catalog: "r.io/c/idx:v4.22" }, { catalog: "r.io/d/idx:v4.22" }],
      // The shape createExecutionPlan stores: an array of per-operator checks.
      verification: [
        { catalogImage: "r.io/a/idx:v4.22", catalogDigest: D("a") },
        { catalogImage: "r.io/b/idx:v4.22", catalogDigest: D("b") },
        { catalogImage: "r.io/d/idx:v4.22" }
      ]
    } } };
    const pinned = [{ catalog: `r.io/a/idx@${D("a")}` }, { catalog: `r.io/b/idx@${D("f")}` }, { catalog: `r.io/c/idx@${D("c")}` }, { catalog: "r.io/d/idx:v4.22" }];
    const r = catalogIdentityReport(plan, pinned);
    assert.deepEqual(r.catalogs.map((c) => c.status), ["matches-verified", "differs-from-verified", "not-verified", "unpinned"]);
    assert.equal(r.offlineReady, false);
    assert.equal(catalogIdentityReport(plan, null).catalogs.every((c) => c.status === "unpinned"), true, "no pinned file means nothing is known to be pinned");
    assert.deepEqual(catalogIdentityReport({ content: { operators: null } }, null), { catalogs: [], offlineReady: true });
  });
});


describe("Option B: is the disconnected side's oc-mirror the executable the connected side ran?", () => {
  const roundTrip = async (name, editManifest = null) => {
    installStub();
    const p = await imagesProfile(name, [`registry.example.invalid/${name}/tool:1`]);
    const run = await m2d(p);
    await prepare(p, run.id);
    const media = copyTransfer(setOf(run), name);
    if (editManifest) {
      const f = path.join(media, "oaa-transfer", "transfer-manifest.json");
      const m = JSON.parse(fs.readFileSync(f, "utf8"));
      editManifest(m);
      fs.writeFileSync(f, JSON.stringify(m, null, 2));
    }
    await api("DELETE", `/api/mirroring/profiles/${p.id}`); // another server: the low-side profile is unknown here
    const recv = await receive(media);
    assert.equal(recv.status, "completed", recv.message);
    return { run, media, recv, target: await profileNow(metaOf(recv).profileId) };
  };
  const identityItem = async (target) => {
    const pf = await api("POST", `/api/mirroring/profiles/${target.id}/preflight`, { mode: "diskToMirror", registryUrl: REGISTRY, mirrorAuthSource: "inline", mirrorPullSecret: MIRROR_SECRET });
    return { pf, item: pf.json.items.find((i) => i.id === "oc-mirror-identity") };
  };

  test("same executable: receipt and preflight say 'same bytes' (no FIPS or suitability claim); README explains the offline check; no local path anywhere", async () => {
    const { run, media, recv, target } = await roundTrip("idsame");
    const toolSha = metaOf(run).plan?.toolSha256 || metaOf(run).tool?.sha256 || sha256(fs.readFileSync(process.env.OC_MIRROR_BIN));
    const r = target.received.at(-1);
    assert.equal(r.toolIdentity.status, "match");
    assert.equal(r.toolIdentity.localSha256, sha256(fs.readFileSync(process.env.OC_MIRROR_BIN)));
    assert.match((await jobOf(recv.id)).output, /oc-mirror build: Same bytes/);
    const { pf, item } = await identityItem(target);
    assert.equal(item.status, "pass");
    assert.match(item.detail, /Same bytes/);
    assert.match(item.detail, /not FIPS capability, and not that the build suits this machine's RHEL version or CPU/);
    assert.equal(pf.json.ok, true, JSON.stringify(pf.json.blockers));
    const readme = fs.readFileSync(path.join(media, "oaa-transfer", "README-TRANSFER.txt"), "utf8");
    assert.match(readme, /CHECK OC-MIRROR ON THE DISCONNECTED SIDE/);
    assert.match(readme, new RegExp(`executable SHA-256: ${toolSha}`));
    assert.match(readme, /sha256sum "\$\(command -v oc-mirror\)"/);
    assert.doesNotMatch(readme, /latest\//, "never a latest URL");
    for (const text of [JSON.stringify(r.toolIdentity), item.detail]) assert.ok(!text.includes(stubDir), "no local path reported");
  });

  test("different executable: 'different bytes', explained as possibly intended, never blocking", async () => {
    const { target } = await roundTrip("iddiff");
    const other = path.join(stubDir, "oc-mirror-other");
    fs.writeFileSync(other, fs.readFileSync(process.env.OC_MIRROR_BIN, "utf8") + "\n// another build\n", { mode: 0o755 });
    process.env.OC_MIRROR_BIN = other;
    const { pf, item } = await identityItem(target);
    assert.equal(item.status, "warn");
    assert.match(item.detail, /Different bytes/);
    assert.match(item.detail, /expected when you installed the build for this machine's RHEL version or CPU architecture and is not by itself a sign of damage/);
    assert.equal(pf.json.ok, true, "a different build is not a blocker");
  });

  test("no usable local oc-mirror: not compared; the existing tool check still blocks the run", async () => {
    const { target } = await roundTrip("idmissing");
    process.env.OC_MIRROR_BIN = path.join(stubDir, "does-not-exist");
    const { pf, item } = await identityItem(target);
    assert.equal(item.status, "unverified");
    assert.match(item.detail, /No usable oc-mirror on this server/);
    assert.equal(pf.json.items.find((i) => i.id === "tool").status, "block");
    assert.equal(pf.json.ok, false);
  });

  test("an empty local binary is not a tool", async () => {
    const { target } = await roundTrip("idempty");
    const empty = path.join(stubDir, "oc-mirror-empty");
    fs.writeFileSync(empty, "", { mode: 0o755 });
    process.env.OC_MIRROR_BIN = empty;
    const { item } = await identityItem(target);
    assert.notEqual(item.status, "pass");
  });

  test("older transfer without a recorded SHA-256: 'not recorded'; spoofed metadata is ignored, not trusted", async () => {
    const legacy = await roundTrip("idlegacy", (m) => { delete m.tool; });
    assert.equal(legacy.target.received.at(-1).toolIdentity.status, "not-recorded");
    assert.equal((await identityItem(legacy.target)).item.status, "info");
    const spoof = await roundTrip("idspoof", (m) => { m.tool = { ...(m.tool || {}), sha256: "not-a-sha", arch: "../../etc", channelRelease: "latest" }; });
    const r = spoof.target.received.at(-1);
    assert.equal(r.toolIdentity.status, "invalid-recorded");
    assert.equal(r.toolSha256, null);
    assert.equal(r.toolArch, null);
    assert.equal(r.toolChannelRelease, null);
  });
});
