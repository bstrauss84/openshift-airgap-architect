/**
 * v2.2.0 Mirroring M5 — content validation and mirror-to-disk execution,
 * through the real HTTP API.
 *
 *  - every run writes an immutable plan (config bytes + plan.json) under the
 *    profile and runs that exact file; nothing secret is written; imported
 *    originals are untouched; the plan is verified before it is shown;
 *  - profiles stay isolated: own plans, paths, history;
 *  - run options and archive size are saved per profile, validated like the
 *    binary validates them, recorded in the plan and passed to oc-mirror;
 *  - mirror to disk only (409 for the other modes until M6);
 *  - the preflight reports structured items;
 *  - live catalog verification uses oc-mirror's own listing; offline means
 *    "unverified", never passed; definitive misses block the run; clients
 *    cannot write verification results;
 *  - a Mirroring signature retry uses the plan and lands in the profile history.
 *
 * oc-mirror is a Node stub. For `list operators` it replays the exact stdout,
 * stderr and exit codes captured from oc-mirror 4.22.19 against a synthetic
 * catalog (fixtures/operator-package-lookup/list-operators-fixtures.json).
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app } from "../src/index.js";
import { secretTempDir } from "../src/utils.js";
import { setCatalogOpenerForTests } from "../src/verifiedCatalog.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

// These tests drive oc-mirror stand-ins; the verified catalog fetch is
// covered by verified-catalog-fetch.test.js. The catalog name is passed
// through so the stand-ins see what they always saw.
setCatalogOpenerForTests(async (image) => ({ localReference: image, resolvedDigest: `sha256:${"d".repeat(64)}`, manifestDigest: `sha256:${"d".repeat(64)}`, fetchedAt: Date.now(), close: async () => {} }));

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, "fixtures", "operator-package-lookup", "list-operators-fixtures.json");
const DATA_DIR = path.resolve(process.env.DATA_DIR || "/data");
const CANARY = "c3ludGhldGljOm01LWNhbmFyeQ==";
const PULL_SECRET = JSON.stringify({ auths: { "registry.redhat.io": { auth: CANARY } } });
const CATALOG = "registry.redhat.io/redhat/redhat-operator-index:v4.22";

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
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");

/**
 * Stub behaviour:
 *  - `version` → a JSON version the plan can record;
 *  - `list operators --package=P [--channel=C]` → replays fixtures:
 *    demo-op → b_package; channel stable/fast → c_channel_*; another channel
 *    → e_channel_missing; does-not-exist → d_package_missing; offline-op →
 *    f2_unreachable_retry1; slow-op sleeps (for Stop);
 *  - a run → echoes argv; signature failure when STUB_SIGNATURE=1 (first run);
 *    records config existence for retries in $STUB_LOG.
 */
const installStub = () => {
  const p = path.join(stubDir, "oc-mirror");
  fs.writeFileSync(p, `#!${process.execPath}
const fs = require("fs");
const args = process.argv.slice(2);
const val = (s) => { const a = args.find((x) => x.startsWith(s + "=")); return a ? a.slice(s.length + 1) : null; };
// Ends by returning with process.exitCode set, never by force-exiting.
const main = () => {
  if (args.includes("version")) { console.log(JSON.stringify({ clientVersion: { gitVersion: "4.22.0-stub-m5", gitCommit: "0000000stubm5" } })); return; }
  if (args.includes("list") && args.includes("operators")) {
    const f = JSON.parse(fs.readFileSync(${JSON.stringify(FIXTURES)}, "utf8")).cases;
    const pkg = val("--package"); const ch = val("--channel");
    const replay = (c) => { process.stdout.write(c.stdout); process.stderr.write(c.stderr); process.exitCode = c.exitCode; };
    if (pkg === "slow-op") { setTimeout(() => replay(f.b_package), 30000); return; }
    if (pkg === "offline-op") return replay(f.f2_unreachable_retry1);
    if (pkg === "does-not-exist") return replay(f.d_package_missing);
    if (ch === "stable") return replay(f.c_channel_stable);
    if (ch === "fast") return replay(f.c_channel_fast);
    if (ch) return replay(f.e_channel_missing);
    return replay(f.b_package); // demo-op and demo-op-* all list as the demo-op package
  }
  const cfgIdx = args.indexOf("--config");
  const cfg = cfgIdx >= 0 ? args[cfgIdx + 1] : "";
  // Like oc-mirror 4.22.19: only --registries.d counts (CONTAINERS_REGISTRIES_D is ignored).
  const regIdx = args.indexOf("--registries.d");
  const retry = regIdx >= 0 && String(args[regIdx + 1]).includes("registries.d-retry");
  // ...and copies it, merged and never deleted, into the workspace it reads.
  const destArg = args.find((a) => a.startsWith("file://") && args[args.indexOf(a) - 1] !== "--from");
  if (regIdx >= 0 && destArg) {
    const wsReg = require("path").join(destArg.slice("file://".length), "working-dir", "containers", "registries.d");
    fs.mkdirSync(wsReg, { recursive: true });
    for (const f of fs.readdirSync(args[regIdx + 1])) fs.copyFileSync(require("path").join(args[regIdx + 1], f), require("path").join(wsReg, f));
  }
  if (process.env.STUB_LOG) fs.appendFileSync(process.env.STUB_LOG + ".regd", JSON.stringify({ retry, sawEnv: Boolean(process.env.CONTAINERS_REGISTRIES_D) }) + "\\n");
  if (process.env.STUB_LOG) fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ retry, config: cfg, configExists: fs.existsSync(cfg) }) + "\\n");
  console.log("ARGV: " + args.join(" "));
  if (process.env.STUB_SIGNATURE === "1" && !retry) {
    console.log("✓ 1 / 1 release images mirrored successfully");
    console.log("✗ 1 / 2 operator images mirrored: Some operator images failed");
    console.log("error mirroring image docker://registry.connect.redhat.com/vendor/demo-operator@sha256:0123 error: reading signatures: reading manifest sha256-0123.sig in registry.connect.redhat.com/vendor/demo-operator: name unknown: Image not found");
    process.exitCode = 1;
    return;
  }
  setTimeout(() => {}, Number(process.env.STUB_RUN_SLEEP_MS || 0));
};
main();
`);
  fs.chmodSync(p, 0o755);
  process.env.OC_MIRROR_BIN = p;
  return p;
};

const reset = async () => {
  await api("POST", "/api/mirroring/start-over", {});
  await api("POST", "/api/start-over", { cancelRunningOcMirror: true });
};

const op = (name, extra = {}) => ({ id: `${CATALOG}::${name}`, name, catalog: "redhat", catalogImage: CATALOG, defaultChannel: "stable", ...extra });

const operatorsProfile = async (selected, name = "ops") => {
  const res = await api("POST", "/api/mirroring/profiles", {
    name, content: { operators: true }, operators: { catalogMinor: "4.22", catalogMinorSource: "user", selected }
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json;
};
const imagesProfile = async (name = "images", images = ["registry.example.invalid/tools/probe:1"]) => {
  const res = await api("POST", "/api/mirroring/profiles", { name, content: { additionalImages: true }, additionalImages: images });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json;
};
const argvOf = (job) => (job.output || "").split("\n").find((l) => l.startsWith("ARGV: ")) || "";

before(async () => {
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-m5-stub-"));
  ({ server, baseUrl } = await createTestServer(app));
});
after(async () => {
  await reset().catch(() => {});
  await closeTestServer(server);
  if (originalBin === undefined) delete process.env.OC_MIRROR_BIN;
  else process.env.OC_MIRROR_BIN = originalBin;
  for (const k of ["STUB_LOG", "STUB_SIGNATURE", "STUB_RUN_SLEEP_MS"]) delete process.env[k];
  fs.rmSync(stubDir, { recursive: true, force: true });
});
beforeEach(async () => {
  for (const k of ["STUB_LOG", "STUB_SIGNATURE", "STUB_RUN_SLEEP_MS"]) delete process.env[k];
  installStub();
  await reset();
});

describe("immutable execution plan", () => {
  test("a run writes the plan first, runs its exact config and records it without secrets", async () => {
    const p = await imagesProfile();
    const preview = await api("POST", `/api/mirroring/profiles/${p.id}/preview`, {});
    const run = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToDisk", rhPullSecret: PULL_SECRET });
    assert.equal(run.status, 200, JSON.stringify(run.json));
    const job = await terminal(run.json.jobId);
    assert.equal(job.status, "completed");
    const meta = metaOf(job);
    const { planId, planSha256, configSha256 } = meta.plan;
    const dir = path.join(p.paths.root, "plans", planId);
    const cfgPath = path.join(dir, "imageset-config.yaml");
    const planPath = path.join(dir, "plan.json");

    assert.equal(meta.configPath, cfgPath, "the run is recorded against the plan's own file");
    assert.match(argvOf(job), new RegExp(`--config ${cfgPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `));
    assert.equal(fs.readFileSync(cfgPath, "utf8"), preview.json.imagesetConfig, "the plan holds exactly the previewed configuration");
    assert.equal(sha256(fs.readFileSync(cfgPath)), configSha256);
    assert.equal(sha256(fs.readFileSync(planPath)), planSha256);
    for (const f of [cfgPath, planPath]) assert.equal(fs.statSync(f).mode & 0o777, 0o444, `${path.basename(f)} is read-only`);
    assert.equal(fs.existsSync(cfgPath), true, "the plan outlives the run");

    const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
    assert.equal(plan.schema, "oaa.mirroring.plan/v1");
    assert.equal(plan.jobId, run.json.jobId);
    assert.deepEqual(plan.workflow, { mode: "mirrorToDisk", dryRun: false });
    assert.equal(plan.tool.version, "4.22.0-stub-m5");
    assert.equal(plan.tool.sha256, sha256(fs.readFileSync(process.env.OC_MIRROR_BIN)));
    assert.equal(plan.execution.archiveDir, p.paths.archivePath);
    assert.equal(plan.execution.cacheDir, p.paths.cachePath);
    assert.deepEqual(plan.content.additionalImages, ["registry.example.invalid/tools/probe:1"]);

    for (const blob of [fs.readFileSync(planPath, "utf8"), JSON.stringify(await jobOf(run.json.jobId)), JSON.stringify((await api("GET", `/api/mirroring/profiles/${p.id}/runs`)).json)]) {
      assert.equal(blob.includes(CANARY), false, "no credential in the plan, the job or the run history");
    }
    // The job's recorded command line names the temporary auth file (a path,
    // removed after the run, as for Install); the plan does not even name it.
    assert.equal(/registry-auth-/.test(fs.readFileSync(planPath, "utf8")), false);
  });

  test("the plan endpoint verifies hashes and refuses a changed plan", async () => {
    const p = await imagesProfile();
    const run = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToDisk", rhPullSecret: PULL_SECRET, dryRun: true });
    const meta = metaOf(await terminal(run.json.jobId));
    assert.match(argvOf(await jobOf(run.json.jobId)), /--dry-run/);
    const ok = await api("GET", `/api/mirroring/profiles/${p.id}/plans/${meta.plan.planId}?sha256=${meta.plan.planSha256}`);
    assert.equal(ok.status, 200);
    assert.equal(ok.json.plan.workflow.dryRun, true);
    const cfg = path.join(p.paths.root, "plans", meta.plan.planId, "imageset-config.yaml");
    fs.chmodSync(cfg, 0o644);
    fs.appendFileSync(cfg, "# edited\n");
    const changed = await api("GET", `/api/mirroring/profiles/${p.id}/plans/${meta.plan.planId}`);
    assert.equal(changed.status, 409);
    assert.equal(changed.json.code, "PLAN_CHANGED");
    assert.equal((await api("GET", `/api/mirroring/profiles/${p.id}/plans/plan-19990101T000000Z-abcdef`)).status, 404);
  });

  test("an imported original is never changed by a run", async () => {
    const yaml = "kind: ImageSetConfiguration\napiVersion: mirror.openshift.io/v2alpha1\nmirror:\n  additionalImages:\n  - name: registry.example.invalid/imported/app:2\n";
    const applied = await api("POST", "/api/mirroring/import/apply", { files: [{ name: "team.yaml", contentBase64: Buffer.from(yaml).toString("base64") }] });
    assert.equal(applied.status, 200, JSON.stringify(applied.json));
    const p = applied.json.profiles.find((x) => (x.imports || []).length);
    const original = path.join(p.paths.root, "imports", `${p.imports[0].sha256}.yaml`);
    const before = fs.readFileSync(original);
    const run = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToDisk", rhPullSecret: PULL_SECRET });
    const meta = metaOf(await terminal(run.json.jobId));
    assert.deepEqual(fs.readFileSync(original), before);
    const plan = JSON.parse(fs.readFileSync(path.join(p.paths.root, "plans", meta.plan.planId, "plan.json"), "utf8"));
    assert.deepEqual(plan.importedOriginals.map((i) => i.sha256), [p.imports[0].sha256]);
  });
});

describe("profiles stay isolated", () => {
  test("two profiles: own plans, own directories, own history", async () => {
    const a = await imagesProfile("alpha", ["registry.example.invalid/a/app:1"]);
    const b = await imagesProfile("beta", ["registry.example.invalid/b/app:1"]);
    const ra = await api("POST", `/api/mirroring/profiles/${a.id}/run`, { mode: "mirrorToDisk", rhPullSecret: PULL_SECRET });
    const ja = await terminal(ra.json.jobId);
    const rb = await api("POST", `/api/mirroring/profiles/${b.id}/run`, { mode: "mirrorToDisk", rhPullSecret: PULL_SECRET });
    const jb = await terminal(rb.json.jobId);
    assert.match(argvOf(ja), new RegExp(`--cache-dir ${a.paths.cachePath} `));
    assert.match(argvOf(ja), new RegExp(`file://${a.paths.archivePath}$`));
    assert.match(argvOf(jb), new RegExp(`--cache-dir ${b.paths.cachePath} `));
    assert.match(argvOf(jb), new RegExp(`file://${b.paths.archivePath}$`));
    assert.ok(metaOf(ja).configPath.startsWith(`${a.paths.root}${path.sep}`));
    assert.ok(metaOf(jb).configPath.startsWith(`${b.paths.root}${path.sep}`));
    assert.match(fs.readFileSync(metaOf(jb).configPath, "utf8"), /b\/app:1/);
    assert.doesNotMatch(fs.readFileSync(metaOf(jb).configPath, "utf8"), /a\/app:1/);
    const runsA = (await api("GET", `/api/mirroring/profiles/${a.id}/runs`)).json.runs.map((r) => r.jobId);
    const runsB = (await api("GET", `/api/mirroring/profiles/${b.id}/runs`)).json.runs.map((r) => r.jobId);
    assert.deepEqual(runsA, [ra.json.jobId]);
    assert.deepEqual(runsB, [rb.json.jobId]);
  });

  test("a directory that escapes the profile through a symlink blocks the run", async () => {
    const p = await imagesProfile();
    fs.mkdirSync(p.paths.root, { recursive: true });
    const elsewhere = fs.mkdtempSync(path.join(DATA_DIR, "m5-elsewhere-"));
    fs.symlinkSync(elsewhere, p.paths.cachePath);
    const pf = await api("POST", `/api/mirroring/profiles/${p.id}/preflight`, { mode: "mirrorToDisk", rhPullSecret: PULL_SECRET });
    assert.equal(pf.json.items.find((i) => i.id === "isolation").status, "block");
    assert.equal(pf.json.ok, false);
    const run = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToDisk", rhPullSecret: PULL_SECRET });
    assert.equal(run.status, 409);
    assert.equal(run.json.code, "PROFILE_NOT_ISOLATED");
    fs.unlinkSync(p.paths.cachePath);
  });

  test("Mirroring runs mirror to disk only in this build", async () => {
    const p = await imagesProfile();
    const pf = await api("POST", `/api/mirroring/profiles/${p.id}/preflight`, { mode: "diskToMirror", registryUrl: "r.example.invalid", mirrorAuthSource: "inline", mirrorPullSecret: PULL_SECRET });
    assert.equal(pf.json.items.find((i) => i.id === "mode").status, "block");
    assert.equal(pf.json.ok, false);
  });
});

describe("run options and archive size", () => {
  test("saved options are validated like the binary validates them, passed to oc-mirror and recorded in the plan", async () => {
    const p = await imagesProfile();
    const bad = await api("POST", `/api/mirroring/profiles/${p.id}`, { execution: { options: { parallelImages: 11, since: "2026-1-31", imageTimeout: "ten minutes" } } });
    assert.equal(bad.status, 400);
    const paths = bad.json.details.map((d) => d.path).sort();
    assert.deepEqual(paths, ["execution.options.imageTimeout", "execution.options.parallelImages", "execution.options.since"]);
    const fractional = await api("POST", `/api/mirroring/profiles/${p.id}`, { options: { archiveSize: 4.5 } });
    assert.equal(fractional.status, 400);
    assert.equal(fractional.json.details[0].message, "Archive size must be a whole number of GiB.");

    const ok = await api("POST", `/api/mirroring/profiles/${p.id}`, {
      options: { archiveSize: 8 },
      execution: { options: { parallelImages: 8, parallelLayers: 10, retryTimes: 3, retryDelay: "5s", imageTimeout: "30m", logLevel: "debug", since: "2026-01-31" } }
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.deepEqual(ok.json.execution.options, { parallelImages: 8, parallelLayers: 10, retryTimes: 3, retryDelay: "5s", imageTimeout: "30m", logLevel: "debug", since: "2026-01-31" });
    const preview = await api("POST", `/api/mirroring/profiles/${p.id}/preview`, {});
    assert.match(preview.json.imagesetConfig, /^archiveSize: 8$/m);

    const run = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToDisk", rhPullSecret: PULL_SECRET });
    const job = await terminal(run.json.jobId);
    const argv = argvOf(job);
    for (const flag of ["--parallel-images 8", "--parallel-layers 10", "--retry-times 3", "--retry-delay 5s", "--image-timeout 30m", "--log-level debug", "--since 2026-01-31"]) assert.ok(argv.includes(flag), `${flag} in ${argv}`);
    const plan = JSON.parse(fs.readFileSync(path.join(p.paths.root, "plans", metaOf(job).plan.planId, "plan.json"), "utf8"));
    assert.equal(plan.execution.options.archiveSize, 8);
    assert.equal(plan.execution.options.parallelImages, 8);

    const cleared = await api("POST", `/api/mirroring/profiles/${p.id}`, { options: { archiveSize: null }, execution: { options: { since: null } } });
    assert.equal(cleared.json.options.archiveSize, undefined);
    assert.equal(cleared.json.execution.options.since, undefined);
    assert.equal(cleared.json.execution.options.parallelImages, 8, "other options are kept");
  });
});

describe("structured preflight", () => {
  test("profile, workflow, configuration identity, isolation, paths, credentials, tool and trust", async () => {
    const p = await imagesProfile();
    const preview = await api("POST", `/api/mirroring/profiles/${p.id}/preview`, {});
    const pf = await api("POST", `/api/mirroring/profiles/${p.id}/preflight`, { mode: "mirrorToDisk", rhPullSecret: PULL_SECRET });
    assert.equal(pf.status, 200);
    const byId = Object.fromEntries(pf.json.items.map((i) => [i.id, i]));
    for (const id of ["profile", "mode", "config-identity", "isolation", "archive-size", "archive", "cache", "credentials", "config", "options", "tool", "trust"]) assert.ok(byId[id], `item ${id}`);
    assert.match(byId["config-identity"].detail, new RegExp(sha256(preview.json.imagesetConfig)));
    assert.equal(byId.credentials.status, "pass");
    assert.match(byId.credentials.detail, /registry\.redhat\.io/);
    assert.equal(byId.credentials.detail.includes(CANARY), false);
    assert.match(byId.tool.detail, /4\.22\.0-stub-m5/);
    assert.ok(pf.json.items.every((i) => ["pass", "warn", "block", "unverified", "info"].includes(i.status)));
    assert.equal(pf.json.ok, true, JSON.stringify(pf.json.blockers));
  });

  test("credentials follow the content: Red Hat content needs a Red Hat registry; images only may pull anonymously", async () => {
    const ops = await operatorsProfile([op("demo-op")], "needs-redhat");
    const noSecret = await api("POST", `/api/mirroring/profiles/${ops.id}/preflight`, { mode: "mirrorToDisk" });
    assert.equal(noSecret.json.items.find((i) => i.id === "credentials").status, "block");
    assert.equal(noSecret.json.ok, false);
    const otherRegistry = JSON.stringify({ auths: { "registry.example.invalid": { auth: CANARY } } });
    const wrong = await api("POST", `/api/mirroring/profiles/${ops.id}/preflight`, { mode: "mirrorToDisk", rhPullSecret: otherRegistry });
    assert.equal(wrong.json.items.find((i) => i.id === "credentials").status, "block", "no Red Hat registry in the secret");

    const images = await imagesProfile("anonymous-ok", ["registry.example.invalid/tools/probe:1", "quay.example.invalid/x/y:2"]);
    const anon = await api("POST", `/api/mirroring/profiles/${images.id}/preflight`, { mode: "mirrorToDisk" });
    const cred = anon.json.items.find((i) => i.id === "credentials");
    assert.equal(cred.status, "info");
    assert.match(cred.detail, /pulls anonymously/);
    assert.equal(anon.json.ok, true, JSON.stringify(anon.json.blockers));
    const partial = await api("POST", `/api/mirroring/profiles/${images.id}/preflight`, { mode: "mirrorToDisk", rhPullSecret: otherRegistry });
    assert.equal(partial.json.items.find((i) => i.id === "credentials").status, "pass");
    assert.match(partial.json.items.find((i) => i.id === "credentials-images").detail, /No credentials for quay\.example\.invalid/);
    assert.equal(partial.json.items.some((i) => i.id === "credentials-redhat"), false, "no Red Hat warning for content that is not from Red Hat");
    const bad = await api("POST", `/api/mirroring/profiles/${images.id}/preflight`, { mode: "mirrorToDisk", rhPullSecret: "{\"auths\": 1}" });
    assert.equal(bad.status, 400, "a given secret must still be valid (refused by the request schema)");
    const run = await api("POST", `/api/mirroring/profiles/${images.id}/run`, { mode: "mirrorToDisk" });
    assert.equal(run.status, 200);
    assert.doesNotMatch(argvOf(await terminal(run.json.jobId)), /--authfile/, "anonymous: no auth file at all");
  });
});

describe("live catalog verification", () => {
  const verify = async (p, body = { rhPullSecret: PULL_SECRET }) => {
    const res = await api("POST", `/api/mirroring/profiles/${p.id}/verify-catalogs`, body);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    return terminal(res.json.jobId);
  };
  const profileNow = async (id) => (await api("GET", "/api/mirroring")).json.profiles.find((x) => x.id === id);

  test("verified, missing package, missing channel, empty range and offline — each reported for what it is", async () => {
    const p = await operatorsProfile([
      op("demo-op"),
      op("does-not-exist"),
      op("demo-op-beta", { defaultChannel: "beta" }),
      op("demo-op-range", { minVersion: "2.0.0" }),
      op("offline-op")
    ]);
    const job = await verify(p);
    assert.equal(job.status, "completed_with_warnings");
    const now = await profileNow(p.id);
    const status = Object.fromEntries(now.operators.selected.map((o) => [o.id, o.verification?.status]));
    assert.equal(status[`${CATALOG}::demo-op`], "verified");
    assert.equal(status[`${CATALOG}::does-not-exist`], "package-not-found");
    assert.equal(status[`${CATALOG}::demo-op-beta`], "channel-not-found");
    assert.equal(status[`${CATALOG}::demo-op-range`], "range-empty");
    assert.equal(status[`${CATALOG}::offline-op`], "unverified", "unreachable is unverified, never passed or missing");
    assert.match(now.operators.selected.find((o) => o.id === `${CATALOG}::demo-op-range`).verification.message, /1\.0\.0, 1\.0\.1/);
    assert.equal(JSON.stringify(job).includes(CANARY), false);

    const pf = await api("POST", `/api/mirroring/profiles/${p.id}/preflight`, { mode: "mirrorToDisk", rhPullSecret: PULL_SECRET });
    assert.equal(pf.json.items.find((i) => i.id === "catalogs").status, "block");
    const run = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToDisk", rhPullSecret: PULL_SECRET });
    assert.equal(run.status, 409);
    assert.equal(run.json.code, "CATALOG_VERIFICATION_FAILED");
  });

  test("all found: the preflight passes the catalog check; unchecked operators read as unverified", async () => {
    const p = await operatorsProfile([op("demo-op"), op("demo-op-fast", { defaultChannel: "fast", minVersion: "1.1.0" })]);
    const before = await api("POST", `/api/mirroring/profiles/${p.id}/preflight`, { mode: "mirrorToDisk", rhPullSecret: PULL_SECRET });
    assert.equal(before.json.items.find((i) => i.id === "catalogs").status, "unverified");
    assert.equal(before.json.ok, true, "unverified does not block");
    const job = await verify(p);
    assert.equal(job.status, "completed");
    const after = await api("POST", `/api/mirroring/profiles/${p.id}/preflight`, { mode: "mirrorToDisk", rhPullSecret: PULL_SECRET });
    assert.equal(after.json.items.find((i) => i.id === "catalogs").status, "pass");
  });

  test("a client cannot write verification results, and an edited operator reads as stale", async () => {
    const p = await operatorsProfile([op("demo-op")]);
    const forged = await api("POST", `/api/mirroring/profiles/${p.id}`, { operators: { selected: [op("demo-op", { verification: { status: "verified", message: "trust me", checkedAt: 1, catalogImage: CATALOG, channel: "stable", minVersion: "", maxVersion: "" } })] } });
    assert.equal(forged.status, 200);
    assert.equal(forged.json.operators.selected[0].verification, undefined);
    await verify(p);
    const edited = await api("POST", `/api/mirroring/profiles/${p.id}`, { operators: { selected: [op("demo-op", { minVersion: "1.0.1" })] } });
    assert.equal(edited.json.operators.selected[0].verification.status, "verified", "the stored record is kept");
    const pf = await api("POST", `/api/mirroring/profiles/${p.id}/preflight`, { mode: "mirrorToDisk", rhPullSecret: PULL_SECRET });
    const cat = pf.json.catalogVerification.operators[0];
    assert.equal(cat.status, "unverified");
    assert.equal(cat.stale, true);
  });

  test("Stop ends the check; nothing unchecked is recorded as checked", async () => {
    const p = await operatorsProfile([op("slow-op"), op("demo-op")]);
    const res = await api("POST", `/api/mirroring/profiles/${p.id}/verify-catalogs`, { rhPullSecret: PULL_SECRET });
    await waitFor(async () => (await jobOf(res.json.jobId))?.status === "running", "the check to run");
    await new Promise((r) => setTimeout(r, 200));
    assert.equal((await api("POST", `/api/jobs/${res.json.jobId}/stop`, {})).status, 200);
    const job = await terminal(res.json.jobId);
    assert.equal(job.status, "cancelled");
    await new Promise((r) => setTimeout(r, 300));
    const now = await profileNow(p.id);
    assert.ok(now.operators.selected.every((o) => !o.verification), "no operator recorded as checked");
    assert.deepEqual(fs.readdirSync(secretTempDir()).filter((f) => f.startsWith("registry-auth-")), [], "auth file released");
  });

  test("nothing to check: 409", async () => {
    const p = await imagesProfile();
    const res = await api("POST", `/api/mirroring/profiles/${p.id}/verify-catalogs`, { rhPullSecret: PULL_SECRET });
    assert.equal(res.status, 409);
    assert.equal(res.json.code, "NOTHING_TO_VERIFY");
  });
});

describe("Mirroring signature retry", () => {
  test("the retry uses the plan's config, which survives, and lands in the profile history", async () => {
    process.env.STUB_SIGNATURE = "1";
    process.env.STUB_LOG = path.join(stubDir, "m5-runs.jsonl");
    fs.rmSync(process.env.STUB_LOG, { force: true });
    const p = await imagesProfile();
    const run = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToDisk", rhPullSecret: PULL_SECRET });
    const original = await terminal(run.json.jobId);
    assert.equal(original.status, "completed_with_warnings");
    const retryId = await waitFor(async () => metaOf(await jobOf(run.json.jobId)).retriedAs, "the retry");
    const retry = await terminal(retryId);
    assert.equal(retry.status, "completed");
    const [first, second] = fs.readFileSync(process.env.STUB_LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(second.retry, true);
    assert.equal(second.config, first.config);
    assert.equal(second.configExists, true);
    assert.equal(fs.existsSync(first.config), true, "a plan is never deleted");
    assert.equal(metaOf(retry).plan.planId, metaOf(original).plan.planId);
    const runs = (await waitFor(async () => {
      const r = (await api("GET", `/api/mirroring/profiles/${p.id}/runs`)).json.runs;
      return r.length === 2 ? r : null;
    }, "the retry in the history")).map((r) => r.jobId);
    assert.deepEqual(runs, [retryId, run.json.jobId]);
  });

  test("the exemption lasts for the retry only: the workspace copy is restored exactly, a legitimate file there survives", async () => {
    process.env.STUB_SIGNATURE = "1";
    process.env.STUB_LOG = path.join(stubDir, "m5-runs-scope.jsonl");
    fs.rmSync(process.env.STUB_LOG, { force: true });
    fs.rmSync(`${process.env.STUB_LOG}.regd`, { force: true });
    const p = await imagesProfile();
    const wsReg = path.join(p.paths.archivePath, "working-dir", "containers", "registries.d");
    fs.mkdirSync(wsReg, { recursive: true });
    fs.writeFileSync(path.join(wsReg, "site-policy.yaml"), "docker:\n  registry.example.com:\n    use-sigstore-attachments: true\n");
    const run = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToDisk", rhPullSecret: PULL_SECRET });
    await terminal(run.json.jobId);
    const retryId = await waitFor(async () => metaOf(await jobOf(run.json.jobId)).retriedAs, "the retry");
    const retry = await terminal(retryId);
    assert.equal(retry.status, "completed");
    const calls = fs.readFileSync(`${process.env.STUB_LOG}.regd`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.ok(calls.every((c) => c.sawEnv === false), "the ignored CONTAINERS_REGISTRIES_D is not used");
    assert.equal(calls.at(-1).retry, true, "the retry passed --registries.d");
    assert.deepEqual(fs.readdirSync(wsReg), ["site-policy.yaml"], "the exemption file is gone, the site's own file stays");
    assert.match(fs.readFileSync(path.join(wsReg, "site-policy.yaml"), "utf8"), /use-sigstore-attachments: true/);
    assert.equal(fs.existsSync(path.join(p.paths.archivePath, "working-dir", "containers", ".oaa-registries.d-snapshot")), false, "no snapshot left");
    const rec = metaOf(retry).signatureRecovery;
    assert.equal(rec.verified, true);
    assert.deepEqual(rec.resolved, ["registry.connect.redhat.com/vendor/demo-operator"]);
    assert.match(retry.message, /mirrored without sigstore signatures .* will reject these images/);
  });

  test("a workspace whose earlier exemption could not be restored blocks the next run (fail closed)", async () => {
    delete process.env.STUB_SIGNATURE;
    const p = await imagesProfile();
    const containers = path.join(p.paths.archivePath, "working-dir", "containers");
    fs.mkdirSync(path.join(containers, ".oaa-registries.d-snapshot"), { recursive: true });
    fs.writeFileSync(path.join(containers, ".oaa-registries.d-snapshot", "state.json"), JSON.stringify({ existed: false, hash: "not-what-is-there" }));
    fs.mkdirSync(path.join(containers, "registries.d"), { recursive: true });
    fs.writeFileSync(path.join(containers, "registries.d", "exempt.yaml"), "docker:\n  quay.io/x:\n    use-sigstore-attachments: false\n");
    const run = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToDisk", rhPullSecret: PULL_SECRET });
    const job = await terminal(run.json.jobId);
    assert.equal(job.status, "failed");
    assert.match(job.message, /does not match what it was before the signature retry\. The run was not started/);
    assert.ok(fs.existsSync(path.join(containers, ".oaa-registries.d-snapshot")), "kept for an operator to inspect");
  });
});

describe("scoped registries.d (unit)", () => {
  test("snapshot, restore and start-up repair; a second snapshot while one is pending is refused", async () => {
    const { snapshotRegistriesD, restoreRegistriesD, restorePending, workspaceRegistriesDir } = await import("../src/registriesDScope.js");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-regd-"));
    const ledger = path.join(root, "ledger.json");
    const dir = workspaceRegistriesDir("mirrorToDisk", path.join(root, "archives"), null);
    assert.equal(workspaceRegistriesDir("diskToMirror", "/a", "/w"), null, "disk to mirror is never retried");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "keep.yaml"), "keep");
    snapshotRegistriesD(dir, ledger);
    assert.throws(() => snapshotRegistriesD(dir, ledger), /still in .* could not be removed yet/);
    fs.writeFileSync(path.join(dir, "exempt.yaml"), "exempt");
    fs.writeFileSync(path.join(dir, "keep.yaml"), "overwritten by oc-mirror's merge");
    // A crash here: the start-up repair restores it from the ledger.
    const results = restorePending(ledger);
    assert.deepEqual(results.map((r) => r.ok), [true]);
    assert.deepEqual(fs.readdirSync(dir), ["keep.yaml"]);
    assert.equal(fs.readFileSync(path.join(dir, "keep.yaml"), "utf8"), "keep");
    assert.deepEqual(JSON.parse(fs.readFileSync(ledger, "utf8")), []);
    // Absent before: absent after.
    fs.rmSync(dir, { recursive: true, force: true });
    snapshotRegistriesD(dir, ledger);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "exempt.yaml"), "exempt");
    assert.equal(restoreRegistriesD(dir, ledger).ok, true);
    assert.equal(fs.existsSync(dir), false);
    assert.throws(() => snapshotRegistriesD(path.join(root, "elsewhere"), ledger), /Not a workspace registries\.d directory/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
