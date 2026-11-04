/**
 * v2.2.0 stabilization (FQ-SCAN-1) — a Mirroring scan with rhAuthSource
 * "mounted" uses the server's mounted Red Hat pull secret, the same credential
 * Mirroring runs and live catalog checks use; never REGISTRY_AUTH_FILE.
 *
 * The mounted secret is detected when the server module loads, so the file is
 * placed before the import and removed right after (other test files share
 * DATA_DIR). Credentials are synthetic.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA_DIR = path.resolve(process.env.DATA_DIR || "/data");
const MOUNTED_B64 = Buffer.from("mounted-user:mounted-canary-71c").toString("base64");
const mountedFile = path.join(DATA_DIR, "pull-secret.json");
let scratch;
let server;
let baseUrl;
let closeTestServer;
const opened = [];
const saved = { OC_MIRROR_BIN: process.env.OC_MIRROR_BIN, REGISTRY_AUTH_FILE: process.env.REGISTRY_AUTH_FILE, PULL_SECRET_FILE: process.env.PULL_SECRET_FILE };

before(async () => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-scan-mounted-"));
  fs.mkdirSync(DATA_DIR, { recursive: true });
  assert.equal(fs.existsSync(mountedFile), false, "refusing to overwrite an existing DATA_DIR/pull-secret.json");
  delete process.env.PULL_SECRET_FILE;
  fs.writeFileSync(mountedFile, JSON.stringify({ auths: { "registry.redhat.io": { auth: MOUNTED_B64 }, "quay.io": { auth: MOUNTED_B64 } } }), { mode: 0o600 });
  const ambient = path.join(scratch, "registry-auth-file.json");
  fs.writeFileSync(ambient, JSON.stringify({ auths: { "registry.redhat.io": { auth: Buffer.from("ambient:x").toString("base64") } } }));
  process.env.REGISTRY_AUTH_FILE = ambient;
  const bin = path.join(scratch, "oc-mirror");
  fs.writeFileSync(bin, '#!/bin/sh\ncase "$*" in *version*) echo stub; exit 0 ;; esac\necho "NAME   DISPLAY NAME   DEFAULT CHANNEL"\necho "a-op   A Op   stable"\n', { mode: 0o755 });
  process.env.OC_MIRROR_BIN = bin;
  let app;
  try {
    ({ app } = await import("../src/index.js"));
  } finally {
    fs.rmSync(mountedFile, { force: true });
  }
  const { setCatalogOpenerForTests } = await import("../src/verifiedCatalog.js");
  setCatalogOpenerForTests(async (image, opts) => {
    opened.push({ authFile: opts.authFile, contents: opts.authFile ? fs.readFileSync(opts.authFile, "utf8") : null });
    return { localReference: image, resolvedDigest: `sha256:${"b".repeat(64)}`, manifestDigest: `sha256:${"b".repeat(64)}`, fetchedAt: Date.now(), close: async () => {} };
  });
  const lifecycle = await import("./helpers/httpServerLifecycle.js");
  closeTestServer = lifecycle.closeTestServer;
  ({ server, baseUrl } = await lifecycle.createTestServer(app));
});
after(async () => {
  if (server) await closeTestServer(server);
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  fs.rmSync(scratch, { recursive: true, force: true });
});

test("mounted: the mounted Red Hat pull secret is used, only when chosen, and its temporary copy is removed", async () => {
  const post = (url, body) => fetch(`${baseUrl}${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json() }));
  const profile = await post("/api/mirroring/profiles", { name: "mounted scan", content: { operators: true }, operators: { catalogMinor: "4.22" } });
  assert.equal(profile.status, 201);
  const r = await post("/api/operators/scan", { catalogMinor: "4.22", profileId: profile.json.id, rhAuthSource: "mounted" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const deadline = Date.now() + 15000;
  for (const id of Object.values(r.json.jobs)) {
    for (;;) {
      const job = await fetch(`${baseUrl}/api/jobs/${id}`).then((x) => x.json());
      if (["completed", "failed"].includes(job.status)) { assert.equal(job.status, "completed", job.message); break; }
      if (Date.now() > deadline) throw new Error("scan did not settle");
      await new Promise((res) => setTimeout(res, 20));
    }
  }
  assert.equal(opened.length, 3);
  for (const o of opened) {
    assert.notEqual(o.authFile, process.env.REGISTRY_AUTH_FILE, "never REGISTRY_AUTH_FILE");
    assert.ok(o.contents.includes(MOUNTED_B64), "the mounted pull secret");
    assert.equal(fs.existsSync(o.authFile), false, "temporary copy removed");
  }
  const ops = await fetch(`${baseUrl}/api/mirroring/operations`).then((x) => x.json());
  assert.ok(!JSON.stringify(ops).includes(MOUNTED_B64));
});
