/**
 * v2.2.0 recovery hardening — mirror-to-disk archive preservation (E13),
 * incremental transfer cycles and their order on the disconnected side, and
 * content-address checks of archived blobs (E5d), through the real HTTP API.
 *
 * The oc-mirror stub reproduces the behaviour proven on the shipped binary:
 * - mirror to disk deletes every top-level mirror_*.tar in its destination when
 *   it starts — also for --dry-run and for a run that then fails (E13);
 * - a successful run writes working-dir/.history/.history-<time>, its delta
 *   baseline being the newest history (or, with --since D, the newest before D);
 * - archives hold content-addressed blobs docker/registry/v2/blobs/sha256/xx/<hex>/data;
 *   STUB_CORRUPT=1 truncates one blob after its digest was taken (E5d).
 * Exact-binary evidence: ~/oaa-investigations/v220/recovery-research/IMPLEMENTATION_PROOFS.md (X1, X2, X4).
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { app } from "../src/index.js";
import { db } from "../src/db.js";
import { hashArchive } from "../src/mirroringTransfer.js";
import { cycleDecision, baselineFor } from "../src/mirroringCycle.js";
import { classifyRecovery } from "../src/mirroringRecovery.js";
import { parseMapping } from "../src/mirroringVerify.js";
import { parseSignatureErrors } from "../src/registriesDScope.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

const DATA_DIR = path.resolve(process.env.DATA_DIR || "/data");
const SECRET = JSON.stringify({ auths: { "registry.example.invalid:5000": { auth: Buffer.from("u:p").toString("base64") } } });
const REGISTRY = "registry.example.invalid:5000/mirror";

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
const terminal = async (id) => {
  for (let i = 0; i < 800; i++) {
    const j = (await api("GET", `/api/jobs/${id}`)).json;
    if (j && !["queued", "running"].includes(j.status)) return j;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`job ${id} did not settle`);
};
const metaOf = (job) => (job?.metadata_json ? JSON.parse(job.metadata_json) : {});
const treeHash = (dir) => {
  const h = crypto.createHash("sha256");
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const f = path.join(d, e.name); h.update(path.relative(dir, f)); if (e.isDirectory()) walk(f); else h.update(fs.readFileSync(f)); } };
  walk(dir);
  return h.digest("hex");
};

const installStub = () => {
  const p = path.join(stubDir, "oc-mirror");
  fs.writeFileSync(p, `#!${process.execPath}
const fs = require("fs"); const path = require("path"); const crypto = require("crypto"); const { spawnSync } = require("child_process");
const args = process.argv.slice(2);
const main = () => {
  if (args.includes("version")) { console.log(JSON.stringify({ clientVersion: { gitVersion: "4.22.0-stub-hardening", gitCommit: "0" } })); return; }
  const dest = args.find((a) => a.startsWith("file://") && args[args.indexOf(a) - 1] !== "--workspace" && args[args.indexOf(a) - 1] !== "--from");
  if (!dest) {
    const from = args.includes("--from") ? args[args.indexOf("--from") + 1].slice(7) : null;
    if (args.includes("--dry-run") && from) {
      fs.mkdirSync(path.join(from, "working-dir", "dry-run"), { recursive: true });
      fs.writeFileSync(path.join(from, "working-dir", "dry-run", "mapping.txt"), "docker://registry.example.invalid/a/app:1=docker://127.0.0.1:9/mirror/a/app:1\\n");
      console.log("dry run mapping written"); return;
    }
    if (process.env.STUB_FAIL_TEXT && !args.includes("--dry-run")) { console.log(process.env.STUB_FAIL_TEXT); process.exitCode = 8; return; }
    console.log("d2m/m2m ok"); return;
  }
  const dir = dest.slice(7);
  fs.mkdirSync(dir, { recursive: true });
  // E13: every top-level archive goes, first thing, whatever happens next.
  for (const f of fs.readdirSync(dir)) if (/^mirror_\\d{6}\\.tar$/.test(f)) fs.unlinkSync(path.join(dir, f));
  if (args.includes("--dry-run")) { console.log("dry run"); return; }
  if (process.env.STUB_FAIL === "1") { console.log("error: simulated failure"); process.exitCode = 8; return; }
  // A signature retry passes --registries.d; the stub then succeeds (as the shipped binary did, S1).
  if (process.env.STUB_FAIL_TEXT && !args.includes("--registries.d")) { console.log(process.env.STUB_FAIL_TEXT); process.exitCode = 8; return; }
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "stub-wd-"));
  fs.mkdirSync(path.join(tmp, "working-dir"), { recursive: true });
  const cfg = fs.readFileSync(args[args.indexOf("--config") + 1], "utf8");
  fs.writeFileSync(path.join(tmp, "working-dir", "isc_pinned_2026-10-30T00:00:00Z.yaml"), cfg.replace(/^(\\s*-?\\s*catalog:\\s*)(\\S+?):([\\w][\\w.-]*)\\s*$/gm, (_m, l, r) => l + r + "@sha256:" + crypto.createHash("sha256").update(r).digest("hex")));
  const blob = Buffer.from("layer " + Date.now() + Math.random());
  const digest = crypto.createHash("sha256").update(blob).digest("hex");
  const bdir = path.join(tmp, "docker", "registry", "v2", "blobs", "sha256", digest.slice(0, 2), digest);
  fs.mkdirSync(bdir, { recursive: true });
  fs.writeFileSync(path.join(bdir, "data"), process.env.STUB_CORRUPT === "1" ? blob.subarray(0, 5) : blob);
  spawnSync("tar", ["-cf", path.join(dir, "mirror_000001.tar"), "-C", tmp, "working-dir", "docker"]);
  fs.rmSync(tmp, { recursive: true, force: true });
  // History: baseline = newest (or newest before --since), new = baseline + this archive.
  const hdir = path.join(dir, "working-dir", ".history");
  fs.mkdirSync(hdir, { recursive: true });
  fs.writeFileSync(path.join(hdir, ".history-" + new Date().toISOString()), "blobs " + digest + "\\n");
  console.log("archive written");
};
main();
`);
  fs.chmodSync(p, 0o755);
  process.env.OC_MIRROR_BIN = p;
};

before(async () => {
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-hardening-stub-"));
  installStub();
  ({ server, baseUrl } = await createTestServer(app));
});
after(async () => {
  await api("POST", "/api/mirroring/start-over", {}).catch(() => {});
  await closeTestServer(server);
  if (originalBin === undefined) delete process.env.OC_MIRROR_BIN; else process.env.OC_MIRROR_BIN = originalBin;
  for (const k of ["STUB_FAIL", "STUB_CORRUPT", "STUB_FAIL_TEXT"]) delete process.env[k];
  fs.rmSync(stubDir, { recursive: true, force: true });
});
beforeEach(async () => {
  for (const k of ["STUB_FAIL", "STUB_CORRUPT", "STUB_FAIL_TEXT"]) delete process.env[k];
  await api("POST", "/api/mirroring/start-over", {});
});

const imagesProfile = async (name) => (await api("POST", "/api/mirroring/profiles", { name, content: { additionalImages: true }, additionalImages: ["registry.example.invalid/a/app:1"] })).json;
const m2d = async (p, extra = {}) => {
  const r = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToDisk", ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return terminal(r.json.jobId);
};
const prepare = async (p, jobId) => terminal((await api("POST", `/api/mirroring/profiles/${p.id}/transfer`, { jobId })).json.jobId);
const receive = async (dir) => terminal((await api("POST", "/api/mirroring/receive", { transferDir: dir })).json.jobId);
const d2m = (p, planId, registryUrl = REGISTRY) => api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "diskToMirror", registryUrl, mirrorAuthSource: "inline", mirrorPullSecret: SECRET, receivedPlanId: planId });
const planOf = (job) => metaOf(job).plan.planId;

describe("mirror-to-disk archives are never destroyed (E13)", () => {
  test("a dry run and a failing run leave earlier archives byte-identical; each success gets its own set", async () => {
    const p = await imagesProfile("e13");
    const first = await m2d(p);
    assert.equal(first.status, "completed", first.message);
    const set1 = metaOf(first).archiveSet.dir;
    assert.equal(set1, path.join(p.paths.archivePath, "sets", planOf(first)));
    assert.deepEqual(fs.readdirSync(p.paths.archivePath).filter((f) => /^mirror_/.test(f)), [], "nothing left where oc-mirror deletes");
    const h1 = treeHash(set1);
    await m2d(p, { dryRun: true });
    process.env.STUB_FAIL = "1";
    const failed = await m2d(p);
    delete process.env.STUB_FAIL;
    assert.equal(failed.status, "failed");
    assert.equal(metaOf(failed).archiveSet, undefined, "a failed run never gets a set");
    assert.equal(treeHash(set1), h1, "dry and failed runs did not touch the earlier set");
    const prep = await prepare(p, first.id);
    assert.equal(prep.status, "completed", prep.message);
    assert.equal(spawnSync("sha256sum", ["-c", "SHA256SUMS"], { cwd: set1, encoding: "utf8" }).status, 0);
  });

  test("archives left at the top level by an older version are moved aside before the next run, never deleted", async () => {
    const p = await imagesProfile("legacy-top");
    const run = await m2d(p);
    // As an older version left it: the run's archives at the top level, no set recorded.
    const set = metaOf(run).archiveSet.dir;
    for (const f of fs.readdirSync(set)) fs.renameSync(path.join(set, f), path.join(p.paths.archivePath, f));
    fs.rmdirSync(set);
    const m = metaOf(run); delete m.archiveSet;
    db.prepare("UPDATE jobs SET metadata_json = ? WHERE id = ?").run(JSON.stringify(m), run.id);
    const legacyHash = crypto.createHash("sha256").update(fs.readFileSync(path.join(p.paths.archivePath, "mirror_000001.tar"))).digest("hex");
    const next = await m2d(p, { dryRun: true });
    assert.match(next.output, /moved 1 earlier archive file\(s\) to .*sets\/plan-.* Nothing was deleted/);
    const restored = metaOf((await api("GET", `/api/jobs/${run.id}`)).json).archiveSet.dir;
    assert.equal(restored, path.join(p.paths.archivePath, "sets", planOf(run)), "attributed to the run that wrote them");
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(path.join(restored, "mirror_000001.tar"))).digest("hex"), legacyHash);
    // Unattributable leftovers go to preserved/, also never deleted.
    fs.writeFileSync(path.join(p.paths.archivePath, "mirror_000001.tar"), "leftover");
    await m2d(p, { dryRun: true });
    const preserved = fs.readdirSync(path.join(p.paths.archivePath, "preserved"));
    assert.equal(preserved.length, 1);
    assert.equal(fs.readFileSync(path.join(p.paths.archivePath, "preserved", preserved[0], "mirror_000001.tar"), "utf8"), "leftover");
  });
});

describe("transfer cycles and their order", () => {
  test("first full, then deltas chained to their predecessor; an explicit full transfer rebaselines", async () => {
    const p = await imagesProfile("cycles");
    const c1 = await m2d(p);
    const c2 = await m2d(p);
    const c3 = await m2d(p, { fullBaseline: true });
    assert.equal(metaOf(c1).cycle.kind, "full");
    assert.equal(metaOf(c2).cycle.kind, "delta");
    assert.equal(metaOf(c2).cycle.previousPlanId, planOf(c1));
    assert.equal(metaOf(c2).cycle.baseline.sha256, metaOf(c1).cycle.produced.sha256);
    assert.equal(metaOf(c3).cycle.kind, "full", "--since 2000-01-01: no baseline");
    assert.equal(metaOf(c3).cycle.since, "2000-01-01");
    const prep = await prepare(p, c2.id);
    const manifest = JSON.parse(fs.readFileSync(path.join(metaOf(c2).archiveSet.dir, "oaa-transfer", "transfer-manifest.json"), "utf8"));
    assert.equal(manifest.cycle.kind, "delta");
    assert.equal(manifest.cycle.previousPlanId, planOf(c1));
    assert.equal(prep.status, "completed");
  });

  test("the disconnected side refuses a missing predecessor and a rollback, allows repeats, the next delta and a full rebaseline", async () => {
    const p = await imagesProfile("order");
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await m2d(p));
    runs.push(await m2d(p, { fullBaseline: true }));
    for (const r of runs) { assert.equal((await prepare(p, r.id)).status, "completed"); assert.equal((await receive(metaOf(r).archiveSet.dir)).status, "completed"); }
    const [c1, c2, c3, full] = runs.map(planOf);
    const expectRefused = async (planId, code, re) => { const r = await d2m(p, planId); assert.equal(r.status, 409, planId); assert.equal(r.json.code, code); assert.match(r.json.error, re); };
    const expectRun = async (planId) => { const r = await d2m(p, planId); assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal((await terminal(r.json.jobId)).status, "completed"); };
    await expectRefused(c2, "TRANSFER_GAP", new RegExp(`only what changed since .*${c1}.*never loaded`));
    await expectRun(c1);
    await expectRefused(c3, "TRANSFER_GAP", new RegExp(`plan ${c2}`));
    await expectRun(c2);
    await expectRun(c2); // repeat: finishes anything that did not arrive
    await expectRun(c3);
    await expectRefused(c1, "TRANSFER_ROLLBACK", /roll its operator catalogs back/);
    await expectRun(full);
    const pre = await api("POST", `/api/mirroring/profiles/${p.id}/preflight`, { mode: "diskToMirror", registryUrl: REGISTRY, mirrorAuthSource: "inline", mirrorPullSecret: SECRET, receivedPlanId: c3 });
    assert.equal(pre.json.items.find((i) => i.id === "transfer-order").status, "block", "older than the full transfer just loaded");
    const applied = (await api("GET", "/api/mirroring")).json.profiles.find((x) => x.id === p.id).appliedCycles;
    assert.deepEqual(applied.map((a) => a.planId), [c1, c2, c3, full]);
    // Another destination has its own chain.
    const other = await api("POST", `/api/mirroring/profiles/${p.id}/preflight`, { mode: "diskToMirror", registryUrl: "other.example.invalid/x", mirrorAuthSource: "inline", mirrorPullSecret: SECRET, receivedPlanId: c2 });
    assert.equal(other.json.items.find((i) => i.id === "transfer-order").status, "block", "a delta first on a fresh destination is a gap");
    // Survives a restart: the record is in the persisted profile.
    assert.ok(JSON.stringify(db.prepare("SELECT state_json FROM app_state").get()).includes(full));
  });

  test("legacy transfers without an order record are a warning, unless provably older than something loaded", () => {
    const applied = [{ planId: "plan-20261030T120000Z-aaaaaa", planCreatedAt: Date.parse("2026-10-30T12:00:00Z"), produced: null }];
    const legacyNewer = cycleDecision({ planId: "plan-20261031T120000Z-bbbbbb", planCreatedAt: Date.parse("2026-10-31T12:00:00Z"), cycle: null }, applied);
    assert.deepEqual([legacyNewer.status, legacyNewer.allowed], ["unknown", true]);
    const legacyOlder = cycleDecision({ planId: "plan-20261029T120000Z-cccccc", planCreatedAt: Date.parse("2026-10-29T12:00:00Z"), cycle: null }, applied);
    assert.deepEqual([legacyOlder.status, legacyOlder.allowed], ["rollback", false]);
    // Baseline rule as oc-mirror applies it (history.go): newest, or newest strictly before --since 00:00 UTC.
    const hs = [{ name: "a", time: Date.parse("2026-10-28T10:00:00Z") }, { name: "b", time: Date.parse("2026-10-30T10:00:00Z") }];
    assert.equal(baselineFor(hs).name, "b");
    assert.equal(baselineFor(hs, "2026-10-30").name, "a");
    assert.equal(baselineFor(hs, "2000-01-01"), null);
  });
});

describe("archived blob content is checked against its digest (E5d)", () => {
  test("a truncated cache blob is refused at Prepare transfer with the digest named; nothing is deleted", async () => {
    const p = await imagesProfile("corrupt");
    process.env.STUB_CORRUPT = "1";
    const run = await m2d(p);
    delete process.env.STUB_CORRUPT;
    assert.equal(run.status, "completed", "oc-mirror itself reports success (exit 0)");
    const prep = await prepare(p, run.id);
    assert.equal(prep.status, "failed");
    assert.match(prep.message, /contains 1 blob\(s\) whose content does not match their digest \(sha256:[0-9a-f]{64}\)/);
    assert.equal(metaOf(prep).code, "CACHE_CONTENT_CORRUPT");
    assert.equal(metaOf(prep).corruptBlobs.length, 1);
    assert.ok(fs.existsSync(path.join(metaOf(run).archiveSet.dir, "mirror_000001.tar")), "nothing deleted");
    assert.equal(fs.existsSync(path.join(metaOf(run).archiveSet.dir, "oaa-transfer")), false, "no transfer written");
    const good = await m2d(p);
    const ok = await prepare(p, good.id);
    assert.equal(ok.status, "completed", ok.message);
    const manifest = JSON.parse(fs.readFileSync(path.join(metaOf(good).archiveSet.dir, "oaa-transfer", "transfer-manifest.json"), "utf8"));
    assert.deepEqual(manifest.archives[0].contentCheck, { method: "sha256 content address", blobs: 1 });
  });

  test("hashArchive: whole-file SHA-256 and per-blob content addresses in one pass", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-hash-"));
    const good = Buffer.from("hello blob");
    const d = crypto.createHash("sha256").update(good).digest("hex");
    for (const [name, body] of [["ok", good], ["bad", Buffer.from("hello")]]) {
      const root = path.join(tmp, name);
      const bdir = path.join(root, "docker", "registry", "v2", "blobs", "sha256", d.slice(0, 2), d);
      fs.mkdirSync(bdir, { recursive: true });
      fs.writeFileSync(path.join(bdir, "data"), body);
      fs.mkdirSync(path.join(root, "working-dir"));
      fs.writeFileSync(path.join(root, "working-dir", "x.txt"), "x");
      spawnSync("tar", ["-cf", path.join(tmp, `${name}.tar`), "-C", root, "working-dir", "docker"]);
    }
    const ok = await hashArchive(path.join(tmp, "ok.tar"));
    assert.equal(ok.sha256, crypto.createHash("sha256").update(fs.readFileSync(path.join(tmp, "ok.tar"))).digest("hex"));
    assert.deepEqual([ok.blobs, ok.corrupt.length, ok.problems.length], [1, 0, 0]);
    const bad = await hashArchive(path.join(tmp, "bad.tar"));
    assert.deepEqual([bad.blobs, bad.corrupt.length], [1, 1]);
    assert.equal(bad.corrupt[0].digest, `sha256:${d}`);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe("Run the same again (manual recovery) and checking the result", () => {
  const TRANSIENT = "error mirroring image docker://registry.example.invalid/a/app:1 error: copying image: received unexpected HTTP status: 503 Service Unavailable";
  const NOT_FOUND = "error mirroring image docker://registry.example.invalid/a/app:1 error: reading manifest 1 in registry.example.invalid/a/app: manifest unknown";

  test("classification follows the evidence (unit)", () => {
    const run = (o) => ({ status: "failed", exitCode: 8, mode: "mirrorToDisk", ...o });
    assert.equal(classifyRecovery(run({}), [TRANSIENT]).classification, "RETRY_SAME");
    assert.equal(classifyRecovery(run({}), [NOT_FOUND]).eligible, false);
    assert.equal(classifyRecovery(run({}), ["error: unauthorized: authentication required"]).classification, "REPAIR_AUTH_OR_TRUST");
    assert.equal(classifyRecovery(run({}), ["error: x509: certificate signed by unknown authority"]).requires[0], "certificate trust");
    assert.equal(classifyRecovery(run({ status: "cancelled", exitCode: null }), []).classification, "RESUME_PRESERVED_STATE");
    assert.equal(classifyRecovery(run({}), ["something nobody understands"]).classification, "UNSUPPORTED_OR_UNKNOWN");
    assert.equal(classifyRecovery(run({}), ["error: open /data/x: no space left on device"]).classification, "RETRY_SAME");
    assert.equal(classifyRecovery(run({ dryRun: true }), [TRANSIENT]).eligible, false);
    assert.deepEqual(parseMapping("docker://a.io/x:1=docker://m:5000/p/x:1\nnoise\n"), [{ source: "a.io/x:1", destination: "m:5000/p/x:1" }]);
  });

  test("mirror to disk after temporary errors: same bytes, linked attempt, result fully verified; the profile's later edits are not used", async () => {
    const p = await imagesProfile("retry-m2d");
    process.env.STUB_FAIL_TEXT = TRANSIENT;
    const failed = await m2d(p);
    delete process.env.STUB_FAIL_TEXT;
    assert.equal(failed.status, "failed");
    const op = (await api("GET", `/api/mirroring/operations/${failed.id}`)).json.operation;
    assert.equal(op.recovery.classification, "RETRY_SAME");
    assert.equal(op.recovery.eligible, true);
    // The profile changes after the failure; the retry must still run the original configuration.
    await api("POST", `/api/mirroring/profiles/${p.id}`, { additionalImages: ["registry.example.invalid/changed/app:9"] });
    const r = await api("POST", `/api/mirroring/profiles/${p.id}/operations/${failed.id}/retry`, {});
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const attempt = await terminal(r.json.jobId);
    assert.equal(attempt.status, "completed", attempt.message);
    const am = metaOf(attempt);
    assert.equal(am.recoveryOf, failed.id);
    assert.equal(am.plan.configSha256, metaOf(failed).plan.configSha256, "byte-identical configuration");
    assert.notEqual(am.plan.planId, metaOf(failed).plan.planId, "a new plan, linked to the original");
    assert.equal(am.verification.state, "fully-verified", JSON.stringify(am.verification));
    assert.ok(am.verification.checks.some((c) => c.name === "Blob content" && c.ok));
    assert.match(attempt.message, /Result check: fully verified/);
    const cfg = fs.readFileSync(path.join(p.paths.root, "plans", am.plan.planId, "imageset-config.yaml"), "utf8");
    assert.equal(cfg.includes("changed/app"), false);
    const prof = (await api("GET", "/api/mirroring")).json.profiles.find((x) => x.id === p.id);
    assert.deepEqual(prof.recoveries.map((x) => [x.originJobId, x.classification, x.attempts.length]), [[failed.id, "RETRY_SAME", 1]]);
    const linked = (await api("GET", `/api/mirroring/operations/${failed.id}`)).json.operation.links;
    assert.ok(linked.some((l) => l.jobId === attempt.id && l.label === "Run again (attempt)"));
  });

  test("not offered when the source content is gone (not found), for a dry run, or while something runs", async () => {
    const p = await imagesProfile("retry-404");
    process.env.STUB_FAIL_TEXT = NOT_FOUND;
    const failed = await m2d(p);
    delete process.env.STUB_FAIL_TEXT;
    const r = await api("POST", `/api/mirroring/profiles/${p.id}/operations/${failed.id}/retry`, {});
    assert.equal(r.status, 409);
    assert.equal(r.json.code, "RECOVERY_NOT_OFFERED");
    assert.match(r.json.error, /no longer exists at the source/);
    const dry = await m2d(p, { dryRun: true });
    assert.equal((await api("POST", `/api/mirroring/profiles/${p.id}/operations/${dry.id}/retry`, {})).status, 409);
  });

  test("disk to mirror: the received copy is re-hashed first; a changed copy is refused; the result check reports what it could not check", async () => {
    const p = await imagesProfile("retry-d2m");
    const run = await m2d(p);
    await prepare(p, run.id);
    await receive(metaOf(run).archiveSet.dir);
    const planId = planOf(run);
    process.env.STUB_FAIL_TEXT = "error: copying image: received unexpected HTTP status: 502 Bad Gateway";
    const r0 = await d2m(p, planId);
    const failed = await terminal(r0.json.jobId);
    delete process.env.STUB_FAIL_TEXT;
    assert.equal(failed.status, "failed");
    const staged = path.join(p.paths.root, "received", planId, "mirror_000001.tar");
    const original = fs.readFileSync(staged);
    const flipped = Buffer.from(original); flipped[flipped.length - 1024] ^= 0xff;
    fs.writeFileSync(staged, flipped);
    const refused = await api("POST", `/api/mirroring/profiles/${p.id}/operations/${failed.id}/retry`, { registryUrl: REGISTRY, mirrorPullSecret: SECRET });
    assert.equal(refused.status, 409);
    assert.equal(refused.json.code, "TRANSFER_CHANGED");
    fs.writeFileSync(staged, original);
    const r = await api("POST", `/api/mirroring/profiles/${p.id}/operations/${failed.id}/retry`, { registryUrl: REGISTRY, mirrorPullSecret: SECRET });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const attempt = await terminal(r.json.jobId);
    assert.equal(attempt.status, "completed", attempt.message);
    const v = metaOf(attempt).verification;
    assert.ok(["partially-verified", "unverifiable"].includes(v.state), "never claims a check it could not make");
    assert.ok(v.checks.some((c) => !c.ok && /could not be checked|Could not check/i.test(`${c.name} ${c.detail}`)));
    assert.equal(metaOf(attempt).plan.networkConfined, true, "confinement kept");
    assert.equal(metaOf(attempt).recoveryOf, failed.id, "linked to the original run");
  });
});

describe("signature errors as the shipped oc-mirror prints them (OAA_EXACT_BINARY_INTEGRATION S1)", () => {
  const H = "a993895d51c2bb58a2c7111c96bce25000abb2280ec53a7095713ea2d362c5bf";
  test("additional images (tag or digest, registry with a port) and operator images are recognised by the repository named in the error", () => {
    const lines = [
      `error mirroring image localhost:5872/qa/app-01:1 error: reading signatures: reading manifest sha256-${H}.sig in localhost:5872/qa/app-01: name unknown: Image not found`,
      `\x1b[1;91merror mirroring image registry.src.test/qa/app-02@sha256:${H} error: reading signatures: reading manifest sha256-${H}.sig in registry.src.test/qa/app-02: name unknown: Image not found\x1b[0m`,
      `error mirroring image docker://localhost:5872/demo/demo-op-operand@sha256:${H} (Operator bundles: [demo-op.v1.0.1] - Operators: [demo-op]) error: reading signatures: reading manifest sha256-${H}.sig in localhost:5872/demo/demo-op-operand: name unknown: Image not found`,
      `error mirroring image localhost:5872/qa/app-01:1 error: reading signatures: reading manifest sha256-${H}.sig in localhost:5872/qa/app-01: name unknown: Image not found`
    ];
    assert.deepEqual(parseSignatureErrors(lines.join("\n")), ["localhost:5872/qa/app-01", "registry.src.test/qa/app-02", "localhost:5872/demo/demo-op-operand"]);
  });
  test("other failures, even about signatures, are not treated as the signature-read error", () => {
    assert.deepEqual(parseSignatureErrors([
      `error mirroring image quay.io/a/b:1 error: reading signatures: reading manifest sha256-${H}.sig in quay.io/a/b: received unexpected HTTP status: 502 Bad Gateway`,
      "error mirroring image quay.io/a/b:1 error: unauthorized: authentication required",
      "error mirroring image quay.io/a/b:1 error: x509: certificate signed by unknown authority"
    ].join("\n")), []);
  });
  test("an additional-images run that fails only on signature reads gets the scoped automatic retry", async () => {
    const p = await imagesProfile("sig-images");
    process.env.STUB_FAIL_TEXT = `error mirroring image registry.example.invalid/a/app:1 error: reading signatures: reading manifest sha256-${H}.sig in registry.example.invalid/a/app: name unknown: Image not found`;
    const first = await m2d(p);
    assert.equal(first.status, "failed");
    let retryId = null;
    for (let i = 0; i < 400 && !retryId; i++) { retryId = metaOf((await api("GET", `/api/jobs/${first.id}`)).json).retriedAs; if (!retryId) await new Promise((r) => setTimeout(r, 25)); }
    assert.ok(retryId, "the retry was started");
    const retry = await terminal(retryId);
    delete process.env.STUB_FAIL_TEXT;
    assert.equal(retry.status, "completed", retry.message);
    assert.ok(metaOf(retry).fullCommand.includes("--registries.d"));
    assert.deepEqual(metaOf(retry).signatureRecovery.resolved, ["registry.example.invalid/a/app"]);
    assert.match((await api("GET", `/api/jobs/${first.id}`)).json.message, /could not read the signatures of 1 repository \(registry\.example\.invalid\/a\/app\)/);
  });
});

