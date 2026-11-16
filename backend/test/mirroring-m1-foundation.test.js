/**
 * v2.2.0 Mirroring M1 — backend foundation, exercised through the real HTTP API.
 *
 * Covers the M1 acceptance contract (RFC r2 §6, owner decisions 2026-10-23):
 *  - a server-owned Mirroring slice with independently keyed profiles whose
 *    directories are derived per profile and cannot be client-supplied;
 *  - supported-minor boundaries (422) at persistence, generation and execution,
 *    with the platform release and the catalog minor checked independently and
 *    additional-images-only content needing no OpenShift version;
 *  - a neutral lock that never touches the Install lock, and the Install lock
 *    endpoint unchanged;
 *  - Install Start Over / import / state persistence scoped away from Mirroring,
 *    and Mirroring Start Over scoped away from Install;
 *  - one oc-mirror run at a time across both workflows;
 *  - external-config preflight: js-yaml parsing (the missing `yaml` module made
 *    EVERY external config fail) and path containment;
 *  - --since only for mirrorToDisk; --cache-dir passed for mirrorToMirror.
 *
 * oc-mirror itself is replaced by a stub that echoes its argv, so the exact
 * command line OAA builds is observable in the job output.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { app } from "../src/index.js";
import { secretTempDir } from "../src/utils.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

const DATA_DIR = path.resolve(process.env.DATA_DIR || "/data");

let server;
let baseUrl;
let stubDir;
const originalBin = process.env.OC_MIRROR_BIN;

const SYNTHETIC_PULL_SECRET = JSON.stringify({ auths: { "registry.example.invalid": { auth: "dGVzdDp0ZXN0" } } });

const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
};

const waitFor = async (predicate, description, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

/** Stub oc-mirror: answers the version probe, echoes argv, then runs `body`. */
const useStub = (body) => {
  const p = path.join(stubDir, `oc-mirror-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(p, [
    "#!/bin/sh",
    'case "$*" in',
    '  *version*) echo "oc-mirror stub 0.0.0"; exit 0 ;;',
    "esac",
    'echo "ARGV: $*"',
    body
  ].join("\n") + "\n");
  fs.chmodSync(p, 0o755);
  process.env.OC_MIRROR_BIN = p;
};

const jobOf = async (jobId) => (await api("GET", `/api/jobs/${jobId}`)).json;

const terminal = (jobId) => waitFor(async () => {
  const j = await jobOf(jobId);
  return j && !["queued", "running"].includes(j.status) ? j : null;
}, `job ${jobId} to finish`);

const stopJob = (jobId) => api("POST", `/api/jobs/${jobId}/stop`, {});

const resetAll = async () => {
  await api("POST", "/api/mirroring/start-over", {});
  const r = await api("POST", "/api/start-over", { cancelRunningOcMirror: true });
  assert.equal(r.status, 200);
};

const lockInstall422 = async () => {
  const res = await api("POST", "/api/state", {
    version: { versionConfirmed: true },
    release: { channel: "stable-4.22", patchVersion: "4.22.16", confirmed: true }
  });
  assert.equal(res.status, 200);
};

const imagesOnlyProfile = async (name = "images") => {
  const res = await api("POST", "/api/mirroring/profiles", {
    name,
    content: { additionalImages: true },
    additionalImages: ["registry.example.invalid/tools/probe:1"]
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json;
};

before(async () => {
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-m1-stub-"));
  ({ server, baseUrl } = await createTestServer(app));
});

after(async () => {
  await resetAll().catch(() => {});
  await closeTestServer(server);
  if (originalBin === undefined) delete process.env.OC_MIRROR_BIN;
  else process.env.OC_MIRROR_BIN = originalBin;
  fs.rmSync(stubDir, { recursive: true, force: true });
});

describe("Mirroring slice and profiles", () => {
  before(resetAll);

  test("profiles get isolated, server-derived directories", async () => {
    const a = await imagesOnlyProfile("a");
    const b = await imagesOnlyProfile("b");
    assert.match(a.id, /^p-/);
    assert.notEqual(a.id, b.id);
    for (const key of ["archivePath", "workspacePath", "cachePath"]) {
      assert.ok(a.paths[key].startsWith(path.join(DATA_DIR, "oc-mirror", "profiles", a.id)), `${key} under profile a`);
      assert.notEqual(a.paths[key], b.paths[key], `${key} differs between profiles`);
    }
    const listed = await api("GET", "/api/mirroring");
    assert.equal(listed.status, 200);
    assert.equal(listed.json.profiles.length, 2);
  });

  test("a client cannot supply directories, history or unknown fields", async () => {
    const res = await api("POST", "/api/mirroring/profiles", { name: "x", paths: { archivePath: "/etc" } });
    assert.equal(res.status, 400);
    const p = await imagesOnlyProfile("y");
    const patch = await api("POST", `/api/mirroring/profiles/${p.id}`, { history: ["forged"] });
    assert.equal(patch.status, 400);
    const exec = await api("POST", `/api/mirroring/profiles/${p.id}`, { execution: { lastRunJobId: "forged" } });
    assert.equal(exec.status, 400);
  });

  test("invalid image references are refused", async () => {
    const res = await api("POST", "/api/mirroring/profiles", {
      content: { additionalImages: true },
      additionalImages: ["quay.io/x/y:1; rm -rf /"]
    });
    assert.equal(res.status, 400);
  });

  test("unknown profile ids are 404, including path-shaped ids", async () => {
    assert.equal((await api("POST", "/api/mirroring/profiles/p-doesnotexist00", { name: "z" })).status, 404);
    assert.equal((await api("POST", "/api/mirroring/profiles/..%2F..%2Fetc/preview", {})).status, 404);
  });
});

describe("supported-minor boundaries (No Fallback)", () => {
  before(resetAll);

  test("persistence: unsupported platform channel, patch or catalog minor is 422", async () => {
    for (const body of [
      { content: { platform: true }, platform: { release: { channel: "4.23", patchVersion: "4.23.1" } } },
      { content: { platform: true }, platform: { release: { channel: "4.22", patchVersion: "4.23.1" } } },
      { content: { operators: true }, operators: { catalogMinor: "4.23" } },
      // A deselected section is retained, so it may not hold an unsupported version either.
      { content: { additionalImages: true }, additionalImages: ["quay.io/a/b:1"], operators: { catalogMinor: "4.19" } }
    ]) {
      const res = await api("POST", "/api/mirroring/profiles", body);
      assert.equal(res.status, 422, JSON.stringify(body));
      assert.equal(res.json.code, "UNSUPPORTED_VERSION");
      assert.deepEqual(res.json.supportedVersions, ["4.20", "4.21", "4.22"]);
    }
    const listed = await api("GET", "/api/mirroring");
    assert.equal(listed.json.profiles.length, 0, "nothing was stored");
  });

  test("a catalog minor must be an exact minor", async () => {
    const res = await api("POST", "/api/mirroring/profiles", { content: { operators: true }, operators: { catalogMinor: "4.22.3" } });
    assert.equal(res.status, 400);
  });

  test("additional-images-only content generates with no OpenShift version", async () => {
    const p = await imagesOnlyProfile();
    const preview = await api("POST", `/api/mirroring/profiles/${p.id}/preview`, {});
    assert.equal(preview.status, 200, JSON.stringify(preview.json));
    const yaml = preview.json.imagesetConfig;
    assert.match(yaml, /additionalImages:\n\s+- name: registry\.example\.invalid\/tools\/probe:1/);
    assert.doesNotMatch(yaml, /platform:/);
    assert.doesNotMatch(yaml, /operators:/);
    assert.doesNotMatch(yaml, /stable-4\./, "no OpenShift version is invented");
  });

  test("operators need a catalog minor; with platform content the catalogs follow the platform minor (M4 revision)", async () => {
    const op = {
      name: "web-terminal",
      catalogImage: "registry.redhat.io/redhat/redhat-operator-index:v4.21",
      defaultChannel: "fast"
    };
    const noMinor = await api("POST", "/api/mirroring/profiles", { content: { operators: true }, operators: { selected: [op] } });
    assert.equal(noMinor.status, 201);
    const notReady = await api("POST", `/api/mirroring/profiles/${noMinor.json.id}/preview`, {});
    assert.equal(notReady.status, 400);
    assert.equal(notReady.json.code, "PROFILE_NOT_READY");

    // Owner decision 4 originally made the two minors independent; it was
    // revised at M3 acceptance (2026-10-26): with platform content the catalog
    // minor is derived from the platform release and cannot be set apart from it.
    const derived = await api("POST", "/api/mirroring/profiles", {
      content: { platform: true, operators: true },
      platform: { release: { channel: "4.22", patchVersion: "4.22.16" }, architecture: "x86_64" },
      operators: { selected: [op] }
    });
    assert.equal(derived.status, 201);
    assert.equal(derived.json.operators.catalogMinor, "4.22");
    assert.equal(derived.json.operators.catalogMinorSource, "platform");
    // The 4.21-resolved entry went back to intent rather than being re-tagged.
    assert.equal(derived.json.operators.selected[0].catalogImage, null);
    const unlockedPreview = await api("POST", `/api/mirroring/profiles/${derived.json.id}/preview`, {});
    assert.equal(unlockedPreview.status, 400, "platform content needs a locked release");
  });
});

describe("neutral lock and Install isolation", () => {
  before(resetAll);

  test("locking a profile never touches the Install release, and vice versa", async () => {
    const before = (await api("GET", "/api/state")).json;
    const p = await api("POST", "/api/mirroring/profiles", {
      content: { platform: true },
      platform: { release: { channel: "4.21", patchVersion: "4.21.9" } }
    });
    const locked = await api("POST", `/api/mirroring/profiles/${p.json.id}/lock`, {});
    assert.equal(locked.status, 200);
    assert.equal(locked.json.platform.version.locked, true);
    assert.equal(locked.json.platform.version.selectedMinor, "4.21");
    const after = (await api("GET", "/api/state")).json;
    assert.deepEqual(after.release, before.release, "Install release unchanged");
    assert.deepEqual(after.version, before.version, "Install version unchanged");

    await lockInstall422();
    const confirm = await api("POST", "/api/operators/confirm", {});
    assert.equal(confirm.status, 200);
    assert.equal(confirm.json.version.locked, true);
    assert.equal(confirm.json.version.selectedMinor, "4.22");
    const mirroring = (await api("GET", "/api/mirroring")).json;
    assert.equal(mirroring.profiles[0].platform.version.selectedMinor, "4.21", "profile lock unchanged");
  });

  test("a locked profile release is never changed silently", async () => {
    const [profile] = (await api("GET", "/api/mirroring")).json.profiles;
    const change = await api("POST", `/api/mirroring/profiles/${profile.id}`, { platform: { release: { patchVersion: "4.21.10" } } });
    assert.equal(change.status, 409);
    assert.equal(change.json.code, "VERSION_LOCKED");
    const unlock = await api("POST", `/api/mirroring/profiles/${profile.id}/unlock`, {});
    assert.equal(unlock.status, 200);
    const again = await api("POST", `/api/mirroring/profiles/${profile.id}`, { platform: { release: { patchVersion: "4.21.10" } } });
    assert.equal(again.status, 200);
    assert.equal(again.json.platform.version.locked, false, "a write never locks implicitly");
  });

  test("POST /api/state cannot write the Mirroring slice; GET /api/state and run export omit it", async () => {
    const before = (await api("GET", "/api/mirroring")).json;
    const res = await api("POST", "/api/state", { mirroring: { profiles: {} } });
    assert.equal(res.status, 200);
    assert.deepEqual((await api("GET", "/api/mirroring")).json, before);
    assert.equal("mirroring" in (await api("GET", "/api/state")).json, false);
    const exported = await fetch(`${baseUrl}/api/run/export`).then((r) => r.json());
    // (Install's own globalStrategy.mirroring settings are unrelated and stay.)
    assert.equal("mirroring" in exported.state, false);
  });

  test("an Install run import neither erases nor injects Mirroring profiles", async () => {
    const before = (await api("GET", "/api/mirroring")).json;
    const imported = await api("POST", "/api/run/import", {
      schemaVersion: 2,
      state: {
        release: { channel: "4.22", patchVersion: "4.22.16", confirmed: true },
        version: { _schemaVersion: 3, selectedMinor: "4.22", selectedPatch: "4.22.16", locked: true },
        mirroring: { profiles: { "p-injected00000": { name: "evil" } } }
      }
    });
    assert.equal(imported.status, 200, JSON.stringify(imported.json));
    assert.deepEqual((await api("GET", "/api/mirroring")).json, before);
  });

  test("catalog scan with an explicit catalog minor does not need the Install lock", async () => {
    await api("POST", "/api/start-over", {});
    const unsupported = await api("POST", "/api/operators/scan", { catalogMinor: "4.23" });
    assert.equal(unsupported.status, 422);
    const notMinor = await api("POST", "/api/operators/scan", { catalogMinor: "4.22.1" });
    assert.equal(notMinor.status, 400);
    const installGate = await api("POST", "/api/operators/scan", {});
    assert.equal(installGate.json.error, "Version not confirmed.", "Install behaviour unchanged");
    const explicit = await api("POST", "/api/operators/scan", { catalogMinor: "4.22" });
    assert.notEqual(explicit.json?.error, "Version not confirmed.", "explicit minor bypasses the Install lock");
  });
});

describe("Start Over scoping", () => {
  before(resetAll);

  test("Install Start Over keeps Mirroring profiles, its running job and its temp files", async () => {
    useStub("sleep 5");
    const p = await imagesOnlyProfile();
    const run = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToDisk", rhPullSecret: SYNTHETIC_PULL_SECRET });
    assert.equal(run.status, 200, JSON.stringify(run.json));
    const jobId = run.json.jobId;
    assert.equal((await jobOf(jobId)).status, "running");
    // M5: a Mirroring run's config is its immutable plan file; its auth file is a temp file.
    const config = JSON.parse((await jobOf(jobId)).metadata_json).configPath;
    assert.match(config, new RegExp(`/oc-mirror/profiles/${p.id}/plans/plan-[^/]+/imageset-config\\.yaml$`));
    assert.ok(fs.existsSync(config), "the mirroring run's plan config exists");
    const authFiles = () => fs.readdirSync(secretTempDir()).filter((f) => f.startsWith("registry-auth-"));
    assert.equal(authFiles().length, 1, "the mirroring run's auth file exists");

    const so = await api("POST", "/api/start-over", { cancelRunningOcMirror: true });
    assert.equal(so.status, 200);
    assert.equal((await jobOf(jobId)).status, "running", "Install Start Over did not cancel the Mirroring run");
    assert.ok(fs.existsSync(config), "Install Start Over did not delete the Mirroring run's plan");
    assert.equal(authFiles().length, 1, "Install Start Over did not delete the Mirroring run's auth file");
    const mirroring = (await api("GET", "/api/mirroring")).json;
    assert.equal(mirroring.profiles.length, 1, "Mirroring profiles survive Install Start Over");
    assert.equal(mirroring.profiles[0].execution.lastRunJobId, jobId);

    // Mirroring Start Over cancels exactly its own run.
    const mso = await api("POST", "/api/mirroring/start-over", {});
    assert.equal(mso.status, 200);
    assert.deepEqual(mso.json.cancelledJobIds, [jobId]);
    assert.equal((await jobOf(jobId)).status, "cancelled");
    assert.equal(mso.json.mirroring.profiles.length, 0);
  });

  test("Mirroring Start Over never cancels an Install run", async () => {
    useStub("sleep 5");
    await resetAll();
    await lockInstall422();
    const run = await api("POST", "/api/ocmirror/run", { mode: "mirrorToDisk", archivePath: path.join(DATA_DIR, "m1-install-a") });
    assert.equal(run.status, 200, JSON.stringify(run.json));
    const mso = await api("POST", "/api/mirroring/start-over", {});
    assert.deepEqual(mso.json.cancelledJobIds, []);
    assert.equal((await jobOf(run.json.jobId)).status, "running");
    await stopJob(run.json.jobId);
  });
});

describe("one oc-mirror run at a time", () => {
  before(resetAll);

  test("a second run in either workflow is refused with 409 until the first stops", async () => {
    useStub("sleep 5");
    await lockInstall422();
    const first = await api("POST", "/api/ocmirror/run", { mode: "mirrorToDisk", archivePath: path.join(DATA_DIR, "m1-install-b") });
    assert.equal(first.status, 200);

    const second = await api("POST", "/api/ocmirror/run", { mode: "mirrorToDisk", archivePath: path.join(DATA_DIR, "m1-install-c") });
    assert.equal(second.status, 409);
    assert.equal(second.json.code, "OC_MIRROR_RUN_IN_PROGRESS");
    assert.equal(second.json.activeJobId, first.json.jobId);

    const p = await imagesOnlyProfile();
    const mirroringRun = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToDisk", rhPullSecret: SYNTHETIC_PULL_SECRET });
    assert.equal(mirroringRun.status, 409, "Mirroring shares the same single slot");

    assert.equal((await stopJob(first.json.jobId)).status, 200);
    const third = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToDisk", rhPullSecret: SYNTHETIC_PULL_SECRET });
    assert.equal(third.status, 200, "the slot frees as soon as the run is stopped");
    await stopJob(third.json.jobId);
  });

  test("concurrent requests cannot both start", async () => {
    useStub("sleep 5");
    await resetAll();
    await lockInstall422();
    const [a, b] = await Promise.all([
      api("POST", "/api/ocmirror/run", { mode: "mirrorToDisk", archivePath: path.join(DATA_DIR, "m1-race-a") }),
      api("POST", "/api/ocmirror/run", { mode: "mirrorToDisk", archivePath: path.join(DATA_DIR, "m1-race-b") })
    ]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    const started = a.status === 200 ? a : b;
    await stopJob(started.json.jobId);
  });
});

describe("command line built for the shipped binary", () => {
  before(resetAll);

  const argvOf = async (jobId) => {
    const job = await terminal(jobId);
    const line = (job.output || "").split("\n").find((l) => l.startsWith("ARGV: "));
    assert.ok(line, `stub argv captured: ${job.output}`);
    return line;
  };

  test("--since is passed only for mirrorToDisk; Mirroring mirror to mirror uses the profile's paths; disk to mirror needs a received transfer", async () => {
    useStub("exit 0");
    const p = await imagesOnlyProfile();
    const advanced = { since: "2026-01-01" };
    const m2d = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToDisk", rhPullSecret: SYNTHETIC_PULL_SECRET, advanced });
    assert.equal(m2d.status, 200, JSON.stringify(m2d.json));
    const m2dArgv = await argvOf(m2d.json.jobId);
    assert.match(m2dArgv, /--since 2026-01-01/);
    assert.match(m2dArgv, new RegExp(`--cache-dir ${p.paths.cachePath}`));

    // v2.2.0 M6: mirror to mirror runs again for Mirroring profiles, with the
    // profile's own workspace and cache; disk to mirror runs only from a
    // received transfer, never from a regenerated configuration.
    const m2m = await api("POST", `/api/mirroring/profiles/${p.id}/run`, {
      mode: "mirrorToMirror", registryUrl: "registry.example.invalid:5000", rhPullSecret: SYNTHETIC_PULL_SECRET,
      mirrorAuthSource: "inline", mirrorPullSecret: SYNTHETIC_PULL_SECRET, advanced
    });
    assert.equal(m2m.status, 200, JSON.stringify(m2m.json));
    const m2mArgvMirroring = await argvOf(m2m.json.jobId);
    assert.doesNotMatch(m2mArgvMirroring, /--since/);
    assert.match(m2mArgvMirroring, new RegExp(`--cache-dir ${p.paths.cachePath}`), "the profile cache, not $HOME");
    assert.match(m2mArgvMirroring, new RegExp(`--workspace file://${p.paths.workspacePath}`));
    const d2m = await api("POST", `/api/mirroring/profiles/${p.id}/run`, {
      mode: "diskToMirror", registryUrl: "registry.example.invalid:5000", mirrorAuthSource: "inline", mirrorPullSecret: SYNTHETIC_PULL_SECRET
    });
    assert.equal(d2m.status, 409);
    assert.equal(d2m.json.code, "MIRRORING_MODE_NOT_AVAILABLE");

    // The shared command builder is unchanged for Install: no --since outside
    // mirror to disk, and mirror to mirror uses the cache it is given.
    await resetAll();
    await lockInstall422();
    const m2mInstall = await api("POST", "/api/ocmirror/run", {
      mode: "mirrorToMirror", workspacePath: path.join(DATA_DIR, "m1-ws-since"), cachePath: path.join(DATA_DIR, "m1-cache-since"),
      registryUrl: "registry.example.invalid:5000", rhPullSecret: SYNTHETIC_PULL_SECRET,
      mirrorAuthSource: "inline", mirrorPullSecret: SYNTHETIC_PULL_SECRET, advanced
    });
    assert.equal(m2mInstall.status, 200, JSON.stringify(m2mInstall.json));
    const m2mArgv = await argvOf(m2mInstall.json.jobId);
    assert.doesNotMatch(m2mArgv, /--since/);
    assert.match(m2mArgv, new RegExp(`--cache-dir ${path.join(DATA_DIR, "m1-cache-since")}`));
    await terminal(m2mInstall.json.jobId);

    const d2mArchive = path.join(DATA_DIR, "m1-d2m-since");
    fs.mkdirSync(path.join(d2mArchive, "working-dir"), { recursive: true });
    const d2mInstall = await api("POST", "/api/ocmirror/run", {
      mode: "diskToMirror", archivePath: d2mArchive, cachePath: path.join(DATA_DIR, "m1-cache-since"), registryUrl: "registry.example.invalid:5000",
      mirrorAuthSource: "inline", mirrorPullSecret: SYNTHETIC_PULL_SECRET, advanced
    });
    assert.equal(d2mInstall.status, 200, JSON.stringify(d2mInstall.json));
    assert.doesNotMatch(await argvOf(d2mInstall.json.jobId), /--since/);
  });

  test("Install mirrorToMirror now passes its stored cache path", async () => {
    useStub("exit 0");
    await resetAll();
    await lockInstall422();
    const run = await api("POST", "/api/ocmirror/run", {
      mode: "mirrorToMirror", workspacePath: path.join(DATA_DIR, "m1-ws"), registryUrl: "registry.example.invalid:5000",
      mirrorAuthSource: "inline", mirrorPullSecret: SYNTHETIC_PULL_SECRET
    });
    assert.equal(run.status, 200, JSON.stringify(run.json));
    assert.match(await argvOf(run.json.jobId), new RegExp(`--cache-dir ${path.join(DATA_DIR, "oc-mirror", "cache")}`));
  });

  test("Mirroring never reuses Install mirror-registry credentials", async () => {
    const p = await imagesOnlyProfile();
    const res = await api("POST", `/api/mirroring/profiles/${p.id}/run`, { mode: "mirrorToMirror", registryUrl: "r.example.invalid", mirrorAuthSource: "reuse" });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /does not reuse/);
    const pf = await api("POST", `/api/mirroring/profiles/${p.id}/preflight`, { mode: "diskToMirror", registryUrl: "r.example.invalid", mirrorAuthSource: "reuse" });
    assert.equal(pf.status, 200);
    assert.ok(pf.json.blockers.some((b) => /does not reuse/.test(b)));
  });

  test("preflight explains that --since does not apply outside mirrorToDisk", async () => {
    const p = await imagesOnlyProfile();
    const pf = await api("POST", `/api/mirroring/profiles/${p.id}/preflight`, {
      mode: "mirrorToMirror", registryUrl: "r.example.invalid", rhPullSecret: SYNTHETIC_PULL_SECRET,
      mirrorAuthSource: "inline", mirrorPullSecret: SYNTHETIC_PULL_SECRET, advanced: { since: "2026-01-01" }
    });
    assert.ok(pf.json.warnings.some((w) => /--since option applies only to mirror-to-disk/.test(w)), JSON.stringify(pf.json));
    assert.ok(!pf.json.warnings.some((w) => /\$HOME\/\.oc-mirror/.test(w)), "profile cache is always set");
  });
});

describe("external ImageSetConfiguration preflight", () => {
  const dir = path.join(DATA_DIR, "m1-external");
  const preflight = (configPath) => api("POST", "/api/ocmirror/preflight", {
    mode: "mirrorToDisk",
    archivePath: path.join(DATA_DIR, "m1-ext-archive"),
    cachePath: path.join(DATA_DIR, "m1-ext-cache"),
    configSourceType: "uploaded",
    configPath,
    rhPullSecret: SYNTHETIC_PULL_SECRET
  });
  const configBlockers = (res) => res.json.blockers.filter((b) => /config/i.test(b));

  before(() => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "valid.yaml"), "apiVersion: mirror.openshift.io/v2alpha1\nkind: ImageSetConfiguration\nmirror:\n  additionalImages:\n  - name: quay.io/a/b:1\n");
    fs.writeFileSync(path.join(dir, "malformed.yaml"), "apiVersion: [unclosed\n");
    fs.writeFileSync(path.join(dir, "multi.yaml"), "kind: ImageSetConfiguration\napiVersion: v\n---\nkind: ImageSetConfiguration\napiVersion: v\n");
    fs.writeFileSync(path.join(dir, "wrongkind.yaml"), "apiVersion: v1\nkind: ConfigMap\n");
    try { fs.unlinkSync(path.join(dir, "escape.yaml")); } catch { /* none */ }
    fs.symlinkSync("/etc/os-release", path.join(dir, "escape.yaml"));
  });

  test("a valid external config passes (regression: the missing `yaml` module failed every file)", async () => {
    const res = await preflight(path.join(dir, "valid.yaml"));
    assert.equal(res.status, 200);
    assert.deepEqual(configBlockers(res), [], JSON.stringify(res.json.blockers));
    assert.equal(res.json.checks.config, "present");
  });

  test("malformed, multi-document and wrong-kind files are blocked with a specific reason", async () => {
    assert.ok(configBlockers(await preflight(path.join(dir, "malformed.yaml"))).some((b) => /not valid YAML/.test(b)));
    assert.ok(configBlockers(await preflight(path.join(dir, "multi.yaml"))).some((b) => /2 YAML documents\. oc-mirror reads only the first/.test(b)));
    assert.ok(configBlockers(await preflight(path.join(dir, "wrongkind.yaml"))).some((b) => /kind is "ConfigMap"; it must be "ImageSetConfiguration"/.test(b)));
  });

  test("paths outside the allowed roots, traversal and symlink escapes are refused", async () => {
    for (const p of ["/etc/os-release", `${dir}/../../../../etc/os-release`, path.join(dir, "escape.yaml")]) {
      const res = await preflight(p);
      assert.ok(configBlockers(res).some((b) => /must be inside one of/.test(b)), `${p}: ${JSON.stringify(res.json.blockers)}`);
    }
  });

  test("the run route applies the same containment", async () => {
    useStub("exit 0");
    await resetAll();
    await lockInstall422();
    const res = await api("POST", "/api/ocmirror/run", {
      mode: "mirrorToDisk", archivePath: path.join(DATA_DIR, "m1-ext-run"), configSourceType: "uploaded", configPath: "/etc/os-release"
    });
    assert.equal(res.status, 200);
    const job = await terminal(res.json.jobId);
    assert.equal(job.status, "failed");
    assert.match(job.message, /must be inside one of/);
  });
});
