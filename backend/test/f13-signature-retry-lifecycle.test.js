/**
 * F13 (v2.2.0 M5) — the signature auto-retry gets the configuration, the
 * credentials and the temp-file lifetime it needs, and nothing outlives it.
 *
 * Before: the run's `close` handler started the retry asynchronously and then
 * unlinked the generated config and the auth file synchronously, so the retry
 * spawned without them; generated configs also recorded no config path at all.
 * After: the run's resources are handed to the retry, which releases them once,
 * on every exit path.
 *
 * oc-mirror is a stub that records — never prints — whether its --config and
 * --authfile existed when it started, and a hash of the auth file, so the test
 * can prove the retry used the SAME credentials without exposing them.
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { app } from "../src/index.js";
import { secretTempDir } from "../src/utils.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

const DATA_DIR = path.resolve(process.env.DATA_DIR || "/data");
// Synthetic credential ("synthetic:f13-canary"); searched for in every record the run leaves.
const CANARY = "c3ludGhldGljOmYxMy1jYW5hcnk=";
const PULL_SECRET = JSON.stringify({ auths: { "registry.redhat.io": { auth: CANARY } } });

let server;
let baseUrl;
let stubDir;
let stubLog;
const originalBin = process.env.OC_MIRROR_BIN;

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

const waitFor = async (predicate, what, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
};

const jobOf = async (id) => (await api("GET", `/api/jobs/${id}`)).json;
const terminal = (id) => waitFor(async () => {
  const j = await jobOf(id);
  return j && !["queued", "running"].includes(j.status) ? j : null;
}, `job ${id} to settle`);
const metaOf = (job) => (job?.metadata_json ? JSON.parse(job.metadata_json) : {});
const stubRuns = () => (fs.existsSync(stubLog) ? fs.readFileSync(stubLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
// Both places a run's temporary files can live: DATA_DIR/tmp and the private
// (memory-backed) credential directory.
const tmpLeftovers = () => [path.join(DATA_DIR, "tmp"), secretTempDir()].flatMap((dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^(registry-auth-|imageset-|registries\.d-)/.test(f)) : []));

/**
 * First run: one release image ok, one operator image failing its signature
 * read, exit 1 → completed_with_warnings + a retry. Retry runs (recognised by
 * the per-image registries.d) exit with $STUB_RETRY_EXIT after
 * $STUB_RETRY_SLEEP seconds. $STUB_FIRST_SLEEP delays the first run's result.
 */
const installStub = () => {
  const p = path.join(stubDir, "oc-mirror");
  fs.writeFileSync(p, `#!/bin/sh
case "$*" in *version*) echo "oc-mirror stub 0.0.0"; exit 0 ;; esac
cfg=""; auth=""; prev=""; regdir=""; dest=""
for a in "$@"; do
  [ "$prev" = "--config" ] && cfg="$a"
  [ "$prev" = "--authfile" ] && auth="$a"
  [ "$prev" = "--registries.d" ] && regdir="$a"
  [ "$prev" = "--workspace" ] && dest="\${a#file://}"
  case "$a" in file://*) [ "$prev" != "--workspace" ] && [ "$prev" != "--from" ] && [ -z "$dest" ] && dest="\${a#file://}" ;; esac
  prev="$a"
done
# Like oc-mirror 4.22.19: CONTAINERS_REGISTRIES_D is ignored; --registries.d is copied
# (merged, never deleted) into <workspace>/working-dir/containers/registries.d.
if [ -n "$CONTAINERS_REGISTRIES_D" ]; then echo "UNEXPECTED: CONTAINERS_REGISTRIES_D is set" >&2; fi
if [ -n "$regdir" ] && [ -n "$dest" ]; then mkdir -p "$dest/working-dir/containers/registries.d" && cp "$regdir"/* "$dest/working-dir/containers/registries.d/"; fi
retry=no; case "$regdir" in *registries.d-retry*) retry=yes ;; esac
cfgok=no; [ -f "$cfg" ] && cfgok=yes
authok=no; authsha=""; [ -n "$auth" ] && [ -f "$auth" ] && authok=yes && authsha=$(sha256sum "$auth" | cut -d' ' -f1)
regd=""; [ -n "$regdir" ] && regd=$(ls "$regdir" | tr '\\n' ',')
printf '{"retry":"%s","config":"%s","configExists":"%s","auth":"%s","authExists":"%s","authSha":"%s","registriesD":"%s"}\\n' "$retry" "$cfg" "$cfgok" "$auth" "$authok" "$authsha" "$regd" >> "$STUB_LOG"
if [ "$retry" = yes ]; then
  sleep "\${STUB_RETRY_SLEEP:-0}"
  echo "retry done"
  exit "\${STUB_RETRY_EXIT:-0}"
fi
sleep "\${STUB_FIRST_SLEEP:-0}"
echo "✓ 1 / 1 release images mirrored successfully"
echo "✗ 1 / 2 operator images mirrored: Some operator images failed"
echo "error mirroring image docker://registry.connect.redhat.com/vendor/demo-operator@sha256:0123 error: reading signatures: reading manifest sha256-0123.sig in registry.connect.redhat.com/vendor/demo-operator: name unknown: Image not found"
exit 1
`);
  fs.chmodSync(p, 0o755);
  process.env.OC_MIRROR_BIN = p;
};

const lockInstall = async () => {
  const res = await api("POST", "/api/state", {
    version: { versionConfirmed: true },
    release: { channel: "4.22", patchVersion: "4.22.16", confirmed: true },
    operators: { selected: [] },
    imagesetConfig: { additionalImages: "registry.example.invalid/tools/probe:1" }
  });
  assert.equal(res.status, 200, JSON.stringify(res.json));
};

const runBody = (extra = {}) => ({
  mode: "mirrorToDisk",
  archivePath: path.join(DATA_DIR, "f13-archive"),
  cachePath: path.join(DATA_DIR, "f13-cache"),
  rhAuthSource: "inline",
  rhPullSecret: PULL_SECRET,
  advanced: { signatureOptions: { disableCommunity: true } },
  ...extra
});

/** Run, wait for the original, return { original, retryId }. */
const runToRetry = async (body) => {
  const started = await api("POST", "/api/ocmirror/run", body);
  assert.equal(started.status, 200, JSON.stringify(started.json));
  const original = await terminal(started.json.jobId);
  return { original, jobId: started.json.jobId };
};

const retryIdOf = (jobId) => waitFor(async () => metaOf(await jobOf(jobId)).retriedAs, "the retry to be linked");

describe("F13 — signature retry lifecycle", () => {
  before(async () => {
    stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-f13-stub-"));
    stubLog = path.join(stubDir, "runs.jsonl");
    process.env.STUB_LOG = stubLog;
    installStub();
    ({ server, baseUrl } = await createTestServer(app));
  });

  beforeEach(async () => {
    fs.rmSync(stubLog, { force: true });
    delete process.env.STUB_RETRY_EXIT;
    delete process.env.STUB_RETRY_SLEEP;
    delete process.env.STUB_FIRST_SLEEP;
    installStub();
    await api("POST", "/api/start-over", { cancelRunningOcMirror: true });
    await lockInstall();
  });

  after(async () => {
    await api("POST", "/api/start-over", { cancelRunningOcMirror: true }).catch(() => {});
    await closeTestServer(server);
    if (originalBin === undefined) delete process.env.OC_MIRROR_BIN;
    else process.env.OC_MIRROR_BIN = originalBin;
    delete process.env.STUB_LOG;
    fs.rmSync(stubDir, { recursive: true, force: true });
  });

  test("generated config: the retry runs with the same config and credentials, then both are removed", async () => {
    const { original, jobId } = await runToRetry(runBody());
    assert.equal(original.status, "completed_with_warnings");
    const retry = await terminal(await retryIdOf(jobId));
    assert.equal(retry.status, "completed");

    const [first, second] = stubRuns();
    assert.equal(first.retry, "no");
    assert.equal(second.retry, "yes");
    assert.equal(second.configExists, "yes", "the retry must find the generated config");
    assert.equal(second.config, first.config, "same configuration identity");
    assert.equal(second.authExists, "yes", "the retry must find the auth file");
    assert.equal(second.authSha, first.authSha, "same credentials");
    assert.match(second.registriesD, /registry\.connect\.redhat\.com-vendor-demo-operator\.yaml/, "per-image exemption for the failing image");
    assert.match(second.registriesD, /inherited-quay\.io-operatorhubio\.yaml/, "the original run's own exemption is kept, nothing more");

    assert.equal(fs.existsSync(first.config), false, "generated config removed after the retry");
    assert.equal(fs.existsSync(first.auth), false, "auth file removed after the retry");
    assert.deepEqual(tmpLeftovers(), []);
    assert.equal(metaOf(retry).retryOf, jobId);
  });

  test("external config: the operator's file is used by the retry and never deleted", async () => {
    const dir = path.join(DATA_DIR, "f13-external");
    fs.mkdirSync(dir, { recursive: true });
    const cfg = path.join(dir, "imageset-config.yaml");
    fs.writeFileSync(cfg, "kind: ImageSetConfiguration\napiVersion: mirror.openshift.io/v2alpha1\nmirror:\n  additionalImages:\n  - name: registry.example.invalid/tools/probe:1\n");
    const { jobId } = await runToRetry(runBody({ configSourceType: "uploaded", configPath: cfg }));
    const retry = await terminal(await retryIdOf(jobId));
    assert.equal(retry.status, "completed");
    const [first, second] = stubRuns();
    assert.equal(second.config, fs.realpathSync(cfg));
    assert.equal(second.authExists, "yes", "regression: the auth file used to be gone before the retry spawned");
    assert.equal(second.authSha, first.authSha);
    assert.equal(fs.existsSync(cfg), true, "an operator's own file is never deleted");
    assert.equal(fs.existsSync(first.auth), false);
    assert.deepEqual(tmpLeftovers(), []);
  });

  test("a failing retry is recorded as failed and still releases everything", async () => {
    process.env.STUB_RETRY_EXIT = "1";
    const { jobId } = await runToRetry(runBody());
    const retry = await terminal(await retryIdOf(jobId));
    assert.equal(retry.status, "failed");
    const [first] = stubRuns();
    assert.equal(fs.existsSync(first.config), false);
    assert.equal(fs.existsSync(first.auth), false);
    assert.deepEqual(tmpLeftovers(), []);
  });

  test("stopping the retry cancels it and releases everything", async () => {
    process.env.STUB_RETRY_SLEEP = "20";
    const { jobId } = await runToRetry(runBody());
    const retryId = await retryIdOf(jobId);
    await waitFor(async () => (await jobOf(retryId))?.status === "running", "the retry to run");
    const [first] = stubRuns();
    assert.equal(fs.existsSync(first.auth), true, "credentials live while the retry runs");
    assert.equal((await api("POST", `/api/jobs/${retryId}/stop`, {})).status, 200);
    const retry = await terminal(retryId);
    assert.equal(retry.status, "cancelled");
    await waitFor(() => !fs.existsSync(first.auth) && !fs.existsSync(first.config), "the retry's files to be removed");
    assert.deepEqual(tmpLeftovers(), []);
  });

  test("stopping the original run starts no retry and releases everything", async () => {
    process.env.STUB_FIRST_SLEEP = "2";
    const started = await api("POST", "/api/ocmirror/run", runBody());
    await waitFor(() => stubRuns().length === 1, "the run to start");
    assert.equal((await api("POST", `/api/jobs/${started.json.jobId}/stop`, {})).status, 200);
    const original = await terminal(started.json.jobId);
    assert.equal(original.status, "cancelled");
    const [first] = stubRuns();
    await waitFor(() => !fs.existsSync(first.auth) && !fs.existsSync(first.config), "the run's files to be removed");
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal(stubRuns().length, 1, "no retry after a stop");
    assert.equal(metaOf(await jobOf(started.json.jobId)).retriedAs, undefined);
  });

  test("a retry that cannot start fails visibly and releases everything", async () => {
    process.env.STUB_FIRST_SLEEP = "1";
    const started = await api("POST", "/api/ocmirror/run", runBody());
    await waitFor(() => stubRuns().length === 1, "the run to start");
    // The binary disappears before the retry resolves it.
    process.env.OC_MIRROR_BIN = path.join(stubDir, "missing-oc-mirror");
    await terminal(started.json.jobId);
    const retry = await terminal(await retryIdOf(started.json.jobId));
    assert.equal(retry.status, "failed");
    const [first] = stubRuns();
    assert.equal(fs.existsSync(first.config), false);
    assert.equal(fs.existsSync(first.auth), false);
    assert.deepEqual(tmpLeftovers(), []);
  });

  test("no credential reaches job records or output, for the run or the retry", async () => {
    const { jobId } = await runToRetry(runBody());
    const retryId = await retryIdOf(jobId);
    await terminal(retryId);
    for (const id of [jobId, retryId]) {
      const raw = JSON.stringify(await jobOf(id));
      assert.equal(raw.includes(CANARY), false, `job ${id} leaks the pull secret`);
      assert.equal("authFile" in metaOf(await jobOf(id)), false, "no auth file path is recorded");
    }
    const list = JSON.stringify((await api("GET", "/api/jobs")).json);
    assert.equal(list.includes(CANARY), false);
  });
});
