/**
 * v2.2.0 recovery hardening — registry credentials for oc-mirror runs.
 *
 * Parsing and combining (registryAuth.js), and the whole lifecycle through the
 * real HTTP API with an oc-mirror stub that copies the auth file it was given:
 * mixed source/destination accounts, special characters, malformed JSON,
 * conflicts, concurrency, Stop, and that no credential lands in the database,
 * profiles, plans, job records, logs or transfers. The temporary file lives in
 * the private memory-backed directory and is gone after every outcome.
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

import { app } from "../src/index.js";
import { secretTempDir, secretTempLocation } from "../src/utils.js";
import { db } from "../src/db.js";
import { normalizeRegistryKey, parseRegistryAuth, combineRegistryAuths, encodeBasicAuth, RegistryAuthError } from "../src/registryAuth.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

const DATA_DIR = path.resolve(process.env.DATA_DIR || "/data");
// Unusual on purpose: quotes, backslash, colon, unicode, emoji, JSON metacharacters.
const SRC_PASS = 'pä55:w"rd\\{}€😀';
const DST_PASS = "d3st-ïñ$€cret!@#";
const SRC_AUTH = encodeBasicAuth("src-user", SRC_PASS);
const DST_AUTH = encodeBasicAuth("dst-user", DST_PASS);
const RH = JSON.stringify({ auths: { "registry.example.invalid": { auth: SRC_AUTH } } });
const DEST = JSON.stringify({ auths: { "mirror.example.invalid:8443": { auth: DST_AUTH } } });
const DEST_HOST = "mirror.example.invalid:8443/ocp";

let server;
let baseUrl;
let stubDir;
let capture;
const originalBin = process.env.OC_MIRROR_BIN;
const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json, headers: res.headers };
};
const terminal = async (id) => {
  for (let i = 0; i < 800; i++) {
    const j = (await api("GET", `/api/jobs/${id}`)).json;
    if (j && !["queued", "running"].includes(j.status)) return j;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`job ${id} did not settle`);
};
const authFiles = () => fs.readdirSync(secretTempDir()).filter((f) => f.startsWith("registry-auth-"));
/** Every place a credential must never be: the database file, DATA_DIR tree (files), job API, logs. */
const assertNowhere = async (needles, jobIds = []) => {
  const dbText = JSON.stringify(db.prepare("SELECT * FROM jobs").all()) + JSON.stringify(db.prepare("SELECT * FROM app_state").all());
  const walk = (d) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : [];
  const files = walk(path.join(DATA_DIR, "oc-mirror")).filter((f) => fs.statSync(f).size < 2_000_000);
  for (const n of needles) {
    assert.equal(dbText.includes(n), false, "not in the database");
    for (const f of files) assert.equal(fs.readFileSync(f, "utf8").includes(n), false, `not in ${f}`);
    for (const id of jobIds) {
      const log = await (await fetch(`${baseUrl}/api/mirroring/operations/${id}/log`)).text();
      assert.equal(log.includes(n), false, "not in the downloaded log");
      assert.equal(JSON.stringify((await api("GET", `/api/jobs/${id}`)).json).includes(n), false, "not in the job record");
    }
  }
};

const installStub = () => {
  const p = path.join(stubDir, "oc-mirror");
  fs.writeFileSync(p, `#!${process.execPath}
const fs = require("fs"); const path = require("path"); const { spawnSync } = require("child_process");
const args = process.argv.slice(2);
const main = () => {
  if (args.includes("version")) { console.log(JSON.stringify({ clientVersion: { gitVersion: "4.22.0-stub-creds", gitCommit: "0" } })); return; }
  const i = args.indexOf("--authfile");
  if (i >= 0) fs.copyFileSync(args[i + 1], process.env.STUB_AUTH_CAPTURE);
  else fs.writeFileSync(process.env.STUB_AUTH_CAPTURE, "NO-AUTHFILE");
  console.log("running with " + (i >= 0 ? "an auth file" : "no auth file"));
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
};
main();
`);
  fs.chmodSync(p, 0o755);
  process.env.OC_MIRROR_BIN = p;
};

before(async () => {
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-creds-stub-"));
  capture = path.join(stubDir, "captured-auth.json");
  process.env.STUB_AUTH_CAPTURE = capture;
  installStub();
  ({ server, baseUrl } = await createTestServer(app));
});
after(async () => {
  await api("POST", "/api/mirroring/start-over", {}).catch(() => {});
  await closeTestServer(server);
  if (originalBin === undefined) delete process.env.OC_MIRROR_BIN; else process.env.OC_MIRROR_BIN = originalBin;
  delete process.env.STUB_SLEEP_MS;
  delete process.env.STUB_AUTH_CAPTURE;
  fs.rmSync(stubDir, { recursive: true, force: true });
});
beforeEach(async () => {
  delete process.env.STUB_SLEEP_MS;
  fs.rmSync(capture, { force: true });
  await api("POST", "/api/mirroring/start-over", {});
  await api("POST", "/api/start-over", { cancelRunningOcMirror: true });
});
const imagesProfile = async (name) => (await api("POST", "/api/mirroring/profiles", { name, content: { additionalImages: true }, additionalImages: ["registry.example.invalid/a/app:1"] })).json;

describe("parsing and combining credentials (unit)", () => {
  test("registry keys: scheme and trailing slash dropped, host lower-cased, port and path kept; nothing else accepted", () => {
    assert.equal(normalizeRegistryKey("https://Quay.IO/"), "quay.io");
    assert.equal(normalizeRegistryKey("mirror.example.com:8443"), "mirror.example.com:8443");
    assert.equal(normalizeRegistryKey("mirror.example.com:8443/ocp/Team"), "mirror.example.com:8443/ocp/Team");
    assert.equal(normalizeRegistryKey("https://index.docker.io/v1/"), "index.docker.io/v1");
    for (const bad of ["", "user:pw@quay.io", "quay.io?x=1", "quay io", "-bad.example", "http://"]) assert.equal(normalizeRegistryKey(bad), null, bad);
  });

  test("entries: auth, username+password (UTF-8, any character), identity token; malformed input is refused without echoing it", () => {
    const parsed = parseRegistryAuth(JSON.stringify({ auths: { "https://Mirror.Example.com:8443/": { username: "u", password: SRC_PASS }, "quay.io": { auth: SRC_AUTH }, "r.example": { identitytoken: "tok" } } }));
    assert.deepEqual(Object.keys(parsed).sort(), ["mirror.example.com:8443", "quay.io", "r.example"]);
    assert.equal(Buffer.from(parsed["mirror.example.com:8443"].auth, "base64").toString("utf8"), `u:${SRC_PASS}`);
    const secretish = "{\"auths\": {\"quay.io\": {\"auth\": \"c3VwZXItc2VjcmV0LXZhbHVl\" ";
    const cases = [
      [secretish, /not valid JSON/],
      ['{"auths":{"quay.io":{"auth":"not base64 !!"}}}', /not base64 of username:password/],
      ['{"auths":{"quay.io":{"auth":"' + Buffer.from("nocolon").toString("base64") + '"}}}', /not base64 of username:password/],
      ['{"auths":{"quay.io":{}}}', /has no "auth", username and password, or identity token/],
      ['{"auths":{"https://user:pw@quay.io":{"auth":"' + SRC_AUTH + '"}}}', /Destination registry credentials: entry 1 is not a registry address/],
      ['{"auths":{}}', /no registry is listed/],
      ["[1,2]", /must be a JSON object/]
    ];
    for (const [input, re] of cases) {
      assert.throws(() => parseRegistryAuth(input, "destination registry credentials"), (err) => {
        assert.ok(err instanceof RegistryAuthError);
        assert.match(err.message, re);
        assert.equal(err.message.includes("c3VwZXItc2VjcmV0"), false, "never echoes the value");
        assert.equal(err.message.includes(SRC_AUTH), false);
        assert.equal(err.message.includes("pw@"), false, "no credential from a key");
        return true;
      });
    }
  });

  test("combining: different accounts for different registries are kept apart; the same registry with different values is refused", () => {
    const merged = combineRegistryAuths([
      { label: "The source pull secret", auths: parseRegistryAuth(RH) },
      { label: "the destination registry credentials", auths: parseRegistryAuth(DEST) }
    ]);
    assert.deepEqual(merged, { "registry.example.invalid": { auth: SRC_AUTH }, "mirror.example.invalid:8443": { auth: DST_AUTH } });
    assert.deepEqual(combineRegistryAuths([{ label: "a", auths: { "quay.io": { auth: SRC_AUTH } } }, { label: "b", auths: { "quay.io": { auth: SRC_AUTH } } }]), { "quay.io": { auth: SRC_AUTH } }, "identical duplicates are fine");
    assert.throws(() => combineRegistryAuths([{ label: "The source pull secret", auths: { "quay.io": { auth: SRC_AUTH } } }, { label: "the destination registry credentials", auths: { "quay.io": { auth: DST_AUTH } } }]),
      (err) => err.code === "REGISTRY_AUTH_CONFLICT" && /both contain quay\.io with different credentials/.test(err.message) && !err.message.includes(SRC_AUTH));
  });
});

describe("credential lifecycle through the API", () => {
  test("the temporary auth file is private and memory-backed", () => {
    const loc = secretTempLocation();
    const st = fs.lstatSync(loc.dir);
    assert.equal(st.mode & 0o077, 0, "0700");
    assert.equal(st.uid, process.getuid());
    if (fs.existsSync("/dev/shm")) assert.equal(loc.memoryBacked, true, `expected /dev/shm, got ${loc.dir}`);
    assert.equal(loc.dir.startsWith(DATA_DIR), false, "not on the data volume");
  });

  test("mirror to mirror: source and destination accounts both reach oc-mirror, each under its own registry; nothing is kept", async () => {
    const p = await imagesProfile("m2m-creds");
    const r = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToMirror", registryUrl: DEST_HOST, rhPullSecret: RH, mirrorAuthSource: "inline", mirrorPullSecret: DEST });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.headers.get("cache-control"), "no-store", "credential-bearing responses are not cached");
    const job = await terminal(r.json.jobId);
    assert.equal(job.status, "completed", job.message);
    const given = JSON.parse(fs.readFileSync(capture, "utf8"));
    assert.deepEqual(given, { auths: { "registry.example.invalid": { auth: SRC_AUTH }, "mirror.example.invalid:8443": { auth: DST_AUTH } } });
    assert.deepEqual(authFiles(), [], "released");
    await assertNowhere([SRC_AUTH, DST_AUTH, SRC_PASS, DST_PASS], [job.id]);
  });

  test("mirror to disk sends only source credentials; disk to mirror only destination credentials", async () => {
    const p = await imagesProfile("split-creds");
    const m2d = await terminal((await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToDisk", rhPullSecret: RH, mirrorPullSecret: DEST })).json.jobId);
    assert.equal(m2d.status, "completed", m2d.message);
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(capture, "utf8")).auths), ["registry.example.invalid"], "no destination password sent to the source side");
    await terminal((await api("POST", `/api/mirroring/profiles/${p.id}/transfer`, { jobId: m2d.id })).json.jobId);
    assert.equal((await terminal((await api("POST", "/api/mirroring/receive", { transferDir: JSON.parse(m2d.metadata_json).archiveSet.dir })).json.jobId)).status, "completed");
    const d2m = await terminal((await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "diskToMirror", registryUrl: DEST_HOST, mirrorAuthSource: "inline", mirrorPullSecret: DEST, rhPullSecret: RH })).json.jobId);
    assert.equal(d2m.status, "completed", d2m.message);
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(capture, "utf8")).auths), ["mirror.example.invalid:8443"], "no source credential on the disconnected side");
    const manifest = fs.readFileSync(path.join(JSON.parse(m2d.metadata_json).archiveSet.dir, "oaa-transfer", "transfer-manifest.json"), "utf8");
    for (const n of [SRC_AUTH, DST_AUTH]) assert.equal(manifest.includes(n), false, "nothing crosses the air gap");
    await assertNowhere([SRC_AUTH, DST_AUTH, SRC_PASS, DST_PASS], [m2d.id, d2m.id]);
  });

  test("a conflict or malformed credential fails the run with a clear message, no file written, nothing echoed", async () => {
    const p = await imagesProfile("bad-creds");
    const clash = JSON.stringify({ auths: { "registry.example.invalid": { auth: DST_AUTH } } });
    const j1 = await terminal((await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToMirror", registryUrl: DEST_HOST, rhPullSecret: RH, mirrorAuthSource: "inline", mirrorPullSecret: clash })).json.jobId);
    assert.equal(j1.status, "failed");
    assert.match(j1.message, /both contain registry\.example\.invalid with different credentials/);
    const bad = JSON.stringify({ auths: { "registry.example.invalid": { auth: "!!notbase64-" + SRC_PASS } } });
    const r2 = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToDisk", rhPullSecret: bad });
    const j2 = r2.status === 200 ? await terminal(r2.json.jobId) : null;
    const text = JSON.stringify(r2.json) + JSON.stringify(j2);
    assert.equal(text.includes(SRC_PASS), false, "never echoed");
    assert.match(text, /not base64 of username:password|Validation failed/);
    assert.deepEqual(authFiles(), []);
  });

  test("a second run is refused before any credential is written; Stop releases the first run's file", async () => {
    process.env.STUB_SLEEP_MS = "4000";
    const a = await imagesProfile("first");
    const b = await imagesProfile("second");
    const r1 = await api("POST", `/api/mirroring/profiles/${a.id}/run`, { mode: "mirrorToDisk", rhPullSecret: RH });
    assert.equal(r1.status, 200);
    for (let i = 0; i < 200 && !fs.existsSync(capture); i++) await new Promise((r) => setTimeout(r, 25));
    assert.equal(authFiles().length, 1, "the running job owns one file");
    const r2 = await api("POST", `/api/mirroring/profiles/${b.id}/run`, { mode: "mirrorToDisk", rhPullSecret: RH });
    assert.equal(r2.status, 409);
    assert.equal(authFiles().length, 1, "the refused run wrote nothing");
    assert.equal((await api("POST", `/api/jobs/${r1.json.jobId}/stop`, {})).status, 200);
    const j = await terminal(r1.json.jobId);
    assert.equal(j.status, "cancelled");
    for (let i = 0; i < 100 && authFiles().length; i++) await new Promise((r) => setTimeout(r, 25));
    assert.deepEqual(authFiles(), [], "Stop released it");
  });

  test("a crashed predecessor's credential files are removed at start-up (private directory, this instance only)", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-creds-crash-"));
    const probe = spawnSync(process.execPath, ["--input-type=module", "-e", "import { secretTempDir } from './src/utils.js'; console.log(secretTempDir());"], { cwd: path.resolve("."), env: { ...process.env, DATA_DIR: dataDir, NODE_ENV: "test" }, encoding: "utf8" });
    const dir = probe.stdout.trim();
    assert.ok(dir && !dir.startsWith(dataDir), probe.stderr);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stale = path.join(dir, "registry-auth-STALE.json");
    fs.writeFileSync(stale, RH, { mode: 0o600 });
    fs.writeFileSync(path.join(dir, "unrelated.txt"), "keep");
    // Start a backend on that DATA_DIR (NODE_ENV=test: it binds no port), wait for the sweep, stop it.
    const child = spawn(process.execPath, ["--input-type=module", "-e", "await import('./src/index.js');"], { cwd: path.resolve("."), env: { ...process.env, DATA_DIR: dataDir, NODE_ENV: "test" }, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d; });
    for (let i = 0; i < 600 && fs.existsSync(stale); i++) await new Promise((r) => setTimeout(r, 50));
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
    assert.equal(fs.existsSync(stale), false, `stale credential swept: ${stderr.slice(-400)}`);
    assert.equal(fs.existsSync(path.join(dir, "unrelated.txt")), true, "only our own prefixes");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});
