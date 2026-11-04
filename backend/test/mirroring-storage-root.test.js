/**
 * v2.2.0 post-M7 — configurable Mirroring storage root (OAA_MIRROR_STORAGE_ROOT).
 *
 * This file runs in its own process (node --test), so the root is configured
 * before the server module is loaded, exactly as at container start-up. The
 * root is under /var/tmp, outside DATA_DIR and /tmp, so receipts from it prove
 * the root is an accepted transfer location rather than an accident of /tmp.
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import * as mirroringStorageModule from "../src/mirroringStorage.js";

const { storageConfig, checkStorageBase, profileStorage, newProfileStorageBase, legacyBase } = mirroringStorageModule;

const ROOT = fs.mkdtempSync("/var/tmp/oaa-mirror-root-test-");
process.env.OAA_MIRROR_STORAGE_ROOT = ROOT;
// Locations a user may type: a good one, one that is not mounted, a read-only
// one and a symbolic link (the last three must never be usable).
const ROOT2 = fs.mkdtempSync("/var/tmp/oaa-mirror-root2-test-");
const PARENT = fs.mkdtempSync("/var/tmp/oaa-mirror-roots-misc-");
const MISSING = path.join(PARENT, "not-mounted");
const RO = path.join(PARENT, "read-only");
fs.mkdirSync(RO, { mode: 0o500 });
const LINK = path.join(PARENT, "link");
fs.symlinkSync(ROOT2, LINK);

const DATA_DIR = path.resolve(process.env.DATA_DIR || "/data");
const OTHER = fs.mkdtempSync("/var/tmp/oaa-mirror-other-test-");

const { app } = await import("../src/index.js");
const { getState, setState } = await import("../src/utils.js");
const { createTestServer, closeTestServer } = await import("./helpers/httpServerLifecycle.js");

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

const installStub = () => {
  const p = path.join(stubDir, "oc-mirror");
  fs.writeFileSync(p, `#!${process.execPath}
const fs = require("fs"); const path = require("path"); const { spawnSync } = require("child_process");
const args = process.argv.slice(2);
const main = () => {
if (process.env.STUB_SLEEP_MS && !args.includes("version")) { const until = Date.now() + Number(process.env.STUB_SLEEP_MS); while (Date.now() < until) {} }
if (args.includes("version")) { console.log(JSON.stringify({ clientVersion: { gitVersion: "4.22.0-stub-storage", gitCommit: "0000000" } })); return; }
const dest = args.find((a) => a.startsWith("file://") && args[args.indexOf(a) - 1] !== "--workspace" && args[args.indexOf(a) - 1] !== "--from");
if (dest && !args.includes("--dry-run")) {
  const dir = dest.slice(7);
  fs.mkdirSync(path.join(dir, "working-dir", "logs"), { recursive: true });
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "stub-wd-"));
  fs.mkdirSync(path.join(tmp, "working-dir"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "working-dir", "isc_pinned_2026-10-30T00:00:00Z.yaml"), fs.readFileSync(args[args.indexOf("--config") + 1]));
  spawnSync("tar", ["-cf", path.join(dir, "mirror_000001.tar"), "-C", tmp, "working-dir"]);
  fs.rmSync(tmp, { recursive: true, force: true });
  if (process.env.STUB_ERRORS === "1") {
    fs.writeFileSync(path.join(dir, "working-dir", "logs", "mirroring_errors_20261030_120000.txt"), "error mirroring image registry.example.invalid/a/app:1 error: manifest unknown\\n");
    console.log("2 / 3 additional images mirrored: Some additional images failed to be mirrored - please check the logs");
    process.exitCode = 8;
  }
}
};
main();
`);
  fs.chmodSync(p, 0o755);
  process.env.OC_MIRROR_BIN = p;
};

before(async () => {
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-storage-stub-"));
  installStub();
  ({ server, baseUrl } = await createTestServer(app));
});
after(async () => {
  await api("POST", "/api/mirroring/start-over", {}).catch(() => {});
  await closeTestServer(server);
  if (originalBin === undefined) delete process.env.OC_MIRROR_BIN; else process.env.OC_MIRROR_BIN = originalBin;
  delete process.env.STUB_ERRORS;
  delete process.env.STUB_SLEEP_MS;
  fs.chmodSync(RO, 0o700);
  for (const d of [stubDir, ROOT, OTHER, ROOT2, PARENT]) fs.rmSync(d, { recursive: true, force: true });
});
beforeEach(async () => {
  delete process.env.STUB_ERRORS;
  delete process.env.STUB_SLEEP_MS;
  await api("POST", "/api/mirroring/start-over", {});
});

const imagesProfile = async (name) => (await api("POST", "/api/mirroring/profiles", { name, content: { additionalImages: true }, additionalImages: ["registry.example.invalid/a/app:1"] })).json;
/** Put a profile into the stored slice directly, as an older version (or a restored backup) left it. */
const injectProfile = (id, extra) => {
  const state = getState();
  const base = { id, name: `Injected ${id}`, content: { additionalImages: true }, additionalImages: [{ id: "img-a", name: "registry.example.invalid/a/app:1", source: "user" }], ...extra };
  setState({ ...state, mirroring: { ...(state.mirroring || {}), profiles: { ...(state.mirroring?.profiles || {}), [id]: base } } });
};

describe("storage root rules (unit)", () => {
  test("configuration: unset keeps DATA_DIR/oc-mirror; relative, root and system paths are refused, never replaced", () => {
    assert.deepEqual(storageConfig({}, "/data"), { base: "/data/oc-mirror", source: "default", legacy: "/data/oc-mirror", configProblem: "" });
    assert.equal(storageConfig({ OAA_MIRROR_STORAGE_ROOT: "/mnt/mirror-data/" }, "/data").base, "/mnt/mirror-data");
    for (const bad of ["mirror", "/", "/etc/mirror", "/proc", "/usr/share/x"]) {
      const cfg = storageConfig({ OAA_MIRROR_STORAGE_ROOT: bad }, "/data");
      assert.match(cfg.configProblem, /OAA_MIRROR_STORAGE_ROOT/, bad);
      assert.equal(newProfileStorageBase(cfg), bad, "a new profile is pinned to the bad value (blocked), not to DATA_DIR");
      assert.equal(profileStorage({ storageBase: bad }, cfg).accepted, false);
    }
  });

  test("live check: missing, symlink, file and unwritable roots are refused with the reason; a good root reports free space", () => {
    const t = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-root-unit-"));
    assert.match(checkStorageBase(path.join(t, "missing")).problems[0], /does not exist in the container\. Mount the volume there/);
    fs.mkdirSync(path.join(t, "real"));
    fs.symlinkSync(path.join(t, "real"), path.join(t, "link"));
    assert.match(checkStorageBase(path.join(t, "link")).problems[0], /symbolic link/);
    fs.writeFileSync(path.join(t, "file"), "x");
    assert.match(checkStorageBase(path.join(t, "file")).problems[0], /not a directory/);
    if (process.getuid?.() !== 0) {
      fs.mkdirSync(path.join(t, "ro"), { mode: 0o500 });
      assert.match(checkStorageBase(path.join(t, "ro")).problems[0], /cannot read, write and enter .* SELinux, mount it with :Z/);
    }
    const ok = checkStorageBase(path.join(t, "real"));
    assert.equal(ok.ok, true, ok.problems.join(" "));
    assert.ok(ok.freeBytes > 0 && ok.totalBytes >= ok.freeBytes);
    assert.deepEqual(fs.readdirSync(path.join(t, "real")), [], "the write probe leaves nothing behind");
    fs.chmodSync(path.join(t, "ro"), 0o700);
    fs.rmSync(t, { recursive: true, force: true });
  });

  test("a profile without a pin uses the DATA_DIR default; a malformed pin is refused, never redirected", () => {
    const cfg = storageConfig({ OAA_MIRROR_STORAGE_ROOT: "/mnt/new" }, "/data");
    assert.deepEqual(profileStorage({}, cfg), { base: legacyBase("/data"), pinned: null, accepted: true, reason: "" });
    assert.equal(profileStorage({ storageBase: "/mnt/anything" }, cfg).accepted, true, "well-formed: checked live when used");
    for (const bad of ["relative", "/", "/etc/x"]) {
      const r = profileStorage({ storageBase: bad }, cfg);
      assert.equal(r.accepted, false);
      assert.match(r.reason, /nothing was moved/);
    }
  });

  test("locations: system, application and other profiles' directories are refused", () => {
    const { locationProblem } = mirroringStorageModule;
    assert.equal(locationProblem("/mnt/mirror-data"), "");
    assert.match(locationProblem("/usr/local/x"), /system directory/);
    assert.match(locationProblem("/app/data"), /application's own directory/);
    assert.match(locationProblem("/"), /filesystem root/);
    assert.match(locationProblem(path.resolve("..", "..")), /application's own directory/, "a parent of the checkout");
    assert.match(locationProblem("/mnt/x/profiles/p-abc12345/sub", { otherProfileRoots: ["/mnt/x/profiles/p-abc12345"] }), /another profile/);
  });
});

describe("configured storage root, through the API", () => {
  test("a new profile is pinned to the root; its archives, plan and paths live there; the run records where", async () => {
    const p = await imagesProfile("on-root");
    assert.equal(p.storageBase, ROOT);
    assert.deepEqual(p.storage, { base: ROOT, source: "configured", accepted: true, reason: null });
    assert.equal(p.paths.root, path.join(ROOT, "profiles", p.id));
    const pre = await api("POST", `/api/mirroring/profiles/${p.id}/preflight`, { mode: "mirrorToDisk" });
    const item = pre.json.items.find((i) => i.id === "storage");
    assert.ok(item.status === "pass" || item.status === "warn", JSON.stringify(item));
    assert.match(item.detail, new RegExp(`Mirroring storage root ${ROOT}`));
    const r = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToDisk" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const job = await terminal(r.json.jobId);
    assert.equal(job.status, "completed", job.message);
    assert.ok(fs.existsSync(path.join(ROOT, "profiles", p.id, "archives", "sets", JSON.parse(job.metadata_json).plan.planId, "mirror_000001.tar")));
    const meta = JSON.parse(job.metadata_json);
    assert.ok(fs.existsSync(path.join(ROOT, "profiles", p.id, "plans", meta.plan.planId, "plan.json")), "the plan is with the content");
    assert.equal(fs.existsSync(path.join(DATA_DIR, "oc-mirror", "profiles", p.id)), false, "nothing under DATA_DIR");
    const op = (await api("GET", `/api/mirroring/operations/${job.id}`)).json.operation;
    assert.deepEqual(op.storage, { base: ROOT, source: "configured", accepted: true, reason: null });
    assert.equal(op.outcome.state, "complete");
    const st = (await api("GET", `/api/mirroring/storage?profileId=${p.id}`)).json;
    assert.equal(st.configured.base, ROOT);
    assert.equal(st.configured.source, "env");
    assert.equal(st.configured.ok, true);
    assert.equal(st.profile.ok, true);
    assert.equal(st.profile.paths.archivePath, path.join(ROOT, "profiles", p.id, "archives"));
    assert.ok(st.profile.freeBytes > 0);
  });

  test("a profile from before the setting keeps using DATA_DIR/oc-mirror; nothing is moved", async () => {
    const id = "p-legacy00001";
    injectProfile(id, {});
    const list = (await api("GET", "/api/mirroring")).json.profiles;
    const p = list.find((x) => x.id === id);
    assert.equal(p.storageBase, null);
    assert.equal(p.storage.source, "default");
    assert.equal(p.paths.root, path.join(DATA_DIR, "oc-mirror", "profiles", id));
    const r = await api("POST", `/api/mirroring/profiles/${id}/run`, { mode: "mirrorToDisk" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const legacyJob = await terminal(r.json.jobId);
    assert.ok(fs.existsSync(path.join(DATA_DIR, "oc-mirror", "profiles", id, "archives", "sets", JSON.parse(legacyJob.metadata_json).plan.planId, "mirror_000001.tar")));
    assert.equal(fs.existsSync(path.join(ROOT, "profiles", id)), false);
  });

  test("a profile whose location is no longer mounted is blocked, not redirected; nothing is written anywhere", async () => {
    const id = "p-moved000001";
    injectProfile(id, { storageBase: MISSING });
    const p = (await api("GET", "/api/mirroring")).json.profiles.find((x) => x.id === id);
    assert.equal(p.storageBase, MISSING);
    const pre = await api("POST", `/api/mirroring/profiles/${id}/preflight`, { mode: "mirrorToDisk" });
    assert.equal(pre.json.ok, false);
    assert.equal(pre.json.items.find((i) => i.id === "storage").status, "block");
    const r = await api("POST", `/api/mirroring/profiles/${id}/run`, { mode: "mirrorToDisk" });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, "MIRRORING_STORAGE_UNAVAILABLE");
    assert.equal(fs.existsSync(MISSING), false, "not created");
    assert.equal(fs.existsSync(path.join(ROOT, "profiles", id)), false);
    assert.equal(fs.existsSync(path.join(DATA_DIR, "oc-mirror", "profiles", id)), false);
  });

  test("a client cannot set or change the pin", async () => {
    const p = (await api("POST", "/api/mirroring/profiles", { name: "x", storageBase: OTHER })).json;
    assert.notEqual(p?.storageBase, OTHER);
    const own = await imagesProfile("pinned");
    const upd = await api("POST", `/api/mirroring/profiles/${own.id}`, { name: "renamed", storageBase: OTHER });
    assert.notEqual(upd.json?.storageBase, OTHER);
    assert.equal((await api("GET", "/api/mirroring")).json.profiles.find((x) => x.id === own.id).storageBase, ROOT);
  });

  test("transfers on the storage volume are received (strict checks unchanged); a received copy there is refused", async () => {
    const p = await imagesProfile("xfer");
    const run = await terminal((await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToDisk" })).json.jobId);
    const prep = await terminal((await api("POST", `/api/mirroring/profiles/${p.id}/transfer`, { jobId: run.id })).json.jobId);
    assert.equal(prep.status, "completed", prep.message);
    // Media copied onto the Mirroring volume (outside DATA_DIR and /tmp).
    const media = path.join(ROOT, "transfer", `site-${crypto.randomBytes(3).toString("hex")}`);
    fs.mkdirSync(path.join(media, "oaa-transfer"), { recursive: true });
    const set = JSON.parse(run.metadata_json).archiveSet.dir;
    for (const f of fs.readdirSync(set)) if (/^mirror_\d{6}\.tar$/.test(f) || f === "SHA256SUMS") fs.copyFileSync(path.join(set, f), path.join(media, f));
    for (const f of fs.readdirSync(path.join(set, "oaa-transfer"))) fs.copyFileSync(path.join(set, "oaa-transfer", f), path.join(media, "oaa-transfer", f));
    const recv = await terminal((await api("POST", "/api/mirroring/receive", { transferDir: media })).json.jobId);
    assert.equal(recv.status, "completed", recv.message);
    const planId = JSON.parse(run.metadata_json).plan.planId;
    const staged = path.join(ROOT, "profiles", p.id, "received", planId);
    assert.ok(fs.existsSync(path.join(staged, "mirror_000001.tar")), "staged under the profile's own root");
    const again = await api("POST", "/api/mirroring/receive", { transferDir: staged });
    assert.equal(again.status, 400);
    assert.equal(again.json.code, "TRANSFER_DIR_IS_RECEIVED_COPY");
    // Outside every accepted root: refused before anything is read.
    const outside = await api("POST", "/api/mirroring/receive", { transferDir: OTHER });
    assert.equal(outside.json.code, "TRANSFER_DIR_INVALID");
  });

  test("an incomplete run says what failed, from the exit status and oc-mirror's own error file", async () => {
    process.env.STUB_ERRORS = "1";
    const p = await imagesProfile("errors");
    const job = await terminal((await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToDisk" })).json.jobId);
    const op = (await api("GET", `/api/mirroring/operations/${job.id}`)).json.operation;
    assert.equal(op.exitCode, 8);
    assert.equal(op.outcome.state, "incomplete");
    assert.deepEqual(op.outcome.parts, ["additional images"]);
    assert.match(op.errorFile.file, /working-dir\/logs\/mirroring_errors_20261030_120000\.txt$/);
    assert.deepEqual(op.errorFile.lines, ["error mirroring image registry.example.invalid/a/app:1 error: manifest unknown"]);
  });
});

describe("choosing a storage location (like Install's directories)", () => {
  test("suggestions: the default and writable volumes mounted into the server", async () => {
    const st = (await api("GET", "/api/mirroring/storage")).json;
    assert.equal(st.suggestions[0].base, ROOT);
    assert.equal(st.suggestions[0].isDefault, true);
    assert.ok(st.suggestions.every((r) => r.ok || r.isDefault));
    assert.ok(st.suggestions.some((r) => r.isDataDirDefault));
  });

  test("a new profile may use any writable location while empty (a missing last directory is created); after its first run it is fixed", async () => {
    const p = await imagesProfile("choose");
    assert.equal(p.storageBase, ROOT);
    let st = (await api("GET", `/api/mirroring/storage?profileId=${p.id}`)).json;
    assert.equal(st.profile.choiceLocked, null);
    const target = path.join(ROOT2, "team-a");
    const moved = await api("POST", `/api/mirroring/profiles/${p.id}/storage`, { base: target });
    assert.equal(moved.status, 200, JSON.stringify(moved.json));
    assert.equal(moved.json.storageBase, target);
    assert.ok(fs.statSync(target).isDirectory(), "created");
    assert.equal(moved.json.paths.root, path.join(target, "profiles", p.id));
    const job = await terminal((await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToDisk" })).json.jobId);
    assert.equal(job.status, "completed", job.message);
    assert.ok(fs.existsSync(path.join(target, "profiles", p.id, "archives")));
    assert.equal(fs.existsSync(path.join(ROOT, "profiles", p.id, "archives")), false, "nothing in the old location");
    st = (await api("GET", `/api/mirroring/storage?profileId=${p.id}`)).json;
    assert.match(st.profile.choiceLocked, /has runs/);
    const back = await api("POST", `/api/mirroring/profiles/${p.id}/storage`, { base: ROOT });
    assert.equal(back.status, 409);
    assert.equal(back.json.code, "STORAGE_ROOT_LOCKED");
    assert.equal((await api("GET", "/api/mirroring")).json.profiles.find((x) => x.id === p.id).storageBase, target, "unchanged");
  });

  test("refused: system and application directories, another profile's directory, missing parents, read-only and symlinked locations", async () => {
    const p = await imagesProfile("refuse");
    const other = await imagesProfile("someone-else");
    for (const base of ["/etc/mirror", "/usr/share/x", "/proc/x", "/app", path.join(other.paths.root, "inside")]) {
      const r = await api("POST", `/api/mirroring/profiles/${p.id}/storage`, { base });
      assert.equal(r.status, 400, base);
      assert.equal(r.json.code, "STORAGE_LOCATION_INVALID", base);
    }
    for (const base of [MISSING + "/deeper", LINK, ...(process.getuid?.() !== 0 ? [RO] : [])]) {
      const r = await api("POST", `/api/mirroring/profiles/${p.id}/storage`, { base });
      assert.equal(r.status, 409, base);
      assert.equal(r.json.code, "MIRRORING_STORAGE_UNAVAILABLE", base);
    }
    assert.equal(fs.existsSync(MISSING), false, "nothing deeper than the last directory is created");
    assert.equal((await api("POST", `/api/mirroring/profiles/${p.id}/storage`, { base: "relative" })).status, 400);
    assert.equal((await api("GET", "/api/mirroring")).json.profiles.find((x) => x.id === p.id).storageBase, ROOT);
  });

  test("no change while any oc-mirror run is in progress", async () => {
    process.env.STUB_SLEEP_MS = "1500";
    const busy = await imagesProfile("busy");
    const other = await imagesProfile("other");
    const r = await api("POST", `/api/mirroring/profiles/${busy.id}/run`, { mode: "mirrorToDisk" });
    assert.equal(r.status, 200);
    const own = await api("POST", `/api/mirroring/profiles/${busy.id}/storage`, { base: ROOT2 });
    assert.equal(own.status, 409);
    const elsewhere = await api("POST", `/api/mirroring/profiles/${other.id}/storage`, { base: ROOT2 });
    assert.equal(elsewhere.status, 409, "the one-run slot is held");
    assert.equal(elsewhere.json.code, "OC_MIRROR_RUN_IN_PROGRESS");
    await terminal(r.json.jobId);
    delete process.env.STUB_SLEEP_MS;
    assert.equal((await api("POST", `/api/mirroring/profiles/${other.id}/storage`, { base: ROOT2 })).status, 200, "free again afterwards");
  });
});

describe("folder browser for the storage location", () => {
  test("lists directories only, under allowed locations; outside, traversal and symlink escapes are refused", async () => {
    fs.mkdirSync(path.join(ROOT2, "site-a"), { recursive: true });
    fs.writeFileSync(path.join(ROOT2, "secret.txt"), "not listed");
    const p = await imagesProfile("browse");
    // ROOT2 becomes an allowed location once a profile uses it.
    assert.equal((await api("POST", `/api/mirroring/profiles/${p.id}/storage`, { base: ROOT2 })).status, 200);
    const start = (await api("GET", "/api/mirroring/storage/browse")).json;
    assert.ok(start.roots.includes(ROOT2) && start.roots.includes(ROOT));
    const listing = (await api("GET", `/api/mirroring/storage/browse?path=${encodeURIComponent(ROOT2)}`)).json;
    assert.ok(listing.entries.includes("site-a"));
    assert.equal(listing.entries.includes("secret.txt"), false, "no files");
    assert.equal(listing.parent, null, "the top of an allowed location");
    assert.equal(listing.writable, true);
    const missing = (await api("GET", `/api/mirroring/storage/browse?path=${encodeURIComponent(path.join(ROOT2, "nope", "deeper"))}`)).json;
    assert.equal(missing.path, ROOT2);
    assert.equal(missing.requestedMissing, true);
    for (const bad of ["/etc", "/usr/share", `${ROOT2}/../..`, LINK.replace("link", "..")]) {
      const r = await api("GET", `/api/mirroring/storage/browse?path=${encodeURIComponent(bad)}`);
      assert.equal(r.status, 403, bad);
    }
    assert.equal((await api("GET", "/api/mirroring/storage/browse?path=relative")).status, 400);
  });
});
