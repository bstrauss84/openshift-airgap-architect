import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const operatorsSource = fs.readFileSync(path.join(__dirname, "../src/operators.js"), "utf8");

const TEST_DATA_DIR = `/tmp/airgap-auth-available-test-${Date.now()}-${process.pid}`;
let originalDataDir;

before(() => {
  originalDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = TEST_DATA_DIR;
  process.env.NODE_ENV = "test";
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
});

after(() => {
  if (originalDataDir !== undefined) process.env.DATA_DIR = originalDataDir;
  else delete process.env.DATA_DIR;
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("authAvailable uses ESM fs import, not require()", () => {
  assert.ok(
    !operatorsSource.includes('require("node:fs")'),
    "operators.js must not use require() for fs — it is an ESM module"
  );
  assert.ok(
    operatorsSource.includes('import fs from "node:fs"'),
    "operators.js must import fs as ESM default import"
  );
});

test("authAvailable checks REGISTRY_AUTH_FILE env var", () => {
  assert.ok(
    operatorsSource.includes("process.env.REGISTRY_AUTH_FILE"),
    "authAvailable must read REGISTRY_AUTH_FILE from env"
  );
  assert.ok(
    operatorsSource.includes("fs.existsSync"),
    "authAvailable must use fs.existsSync to verify the file exists"
  );
});

test("operator scan uses --v2 flag (not deprecated --v1)", () => {
  assert.ok(
    operatorsSource.includes('"--v2"'),
    "operators.js must use --v2 flag for oc-mirror list"
  );
  assert.ok(
    !operatorsSource.includes('"--v1"'),
    "operators.js must not use deprecated --v1 flag"
  );
});

// v2.2.0 M7: the pull secret goes to OAA's own TLS-verified catalog
// fetch; the oc-mirror listing runs offline on a loopback copy and never gets it.
const recordingOcMirror = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-scan-argv-"));
  const log = path.join(dir, "call.json");
  const bin = path.join(dir, "oc-mirror");
  fs.writeFileSync(bin, `#!/usr/bin/env node
require("fs").writeFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), env: process.env }));
console.log("NAME DISPLAY NAME DEFAULT CHANNEL");
`, { mode: 0o755 });
  return { dir, bin, call: () => JSON.parse(fs.readFileSync(log, "utf8")) };
};

const waitTerminal = async (getJob, jobId) => {
  for (let i = 0; i < 200; i++) {
    const job = getJob(jobId);
    if (["completed", "failed", "cancelled"].includes(job?.status)) return job;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("scan did not finish");
};

test("operator scan: the pull secret reaches only the verified fetch; oc-mirror lists a digest-pinned loopback copy without it", async () => {
  const { runScanJob } = await import("../src/operators.js");
  const { getJob } = await import("../src/utils.js");
  const fake = recordingOcMirror();
  const mounted = path.join(fake.dir, "mounted-auth.json");
  fs.writeFileSync(mounted, JSON.stringify({ auths: {} }));
  const saved = process.env.REGISTRY_AUTH_FILE;
  process.env.REGISTRY_AUTH_FILE = mounted;
  const seen = [];
  const local = `127.0.0.1:9/oaa-verified/catalog@sha256:${"b".repeat(64)}`;
  const empty = path.join(fake.dir, "empty-auth.json");
  fs.writeFileSync(empty, '{"auths":{}}');
  try {
    const jobId = runScanJob({
      version: "9.1", catalogId: "redhat", catalogImage: "registry.example.test/redhat/index:v9.1", ocMirrorPath: fake.bin,
      catalogResolver: async (image, opts) => {
        seen.push({ image, authFile: opts.authFile });
        return { localReference: local, emptyAuthFile: empty, resolvedDigest: `sha256:${"c".repeat(64)}`, manifestDigest: `sha256:${"b".repeat(64)}`, fetchedAt: 1, close: async () => {} };
      }
    });
    const job = await waitTerminal(getJob, jobId);
    assert.equal(job.status, "completed", job.message);
    assert.deepEqual(seen, [{ image: "registry.example.test/redhat/index:v9.1", authFile: mounted }]);
    const { argv, env } = fake.call();
    assert.deepEqual(argv.filter((a) => a.startsWith("--authfile")), [`--authfile=${empty}`], "only the empty auth file, never the pull secret");
    assert.ok(argv.every((a) => !a.includes(mounted)), argv.join(" "));
    assert.ok(argv.includes(`--catalog=${local}`));
    assert.ok(argv.includes("--src-tls-verify=false"), "only for the loopback copy");
    assert.equal(env.REGISTRY_AUTH_FILE, undefined, "the mounted auth file must not reach oc-mirror");
    assert.ok(fs.existsSync(mounted), "a mounted REGISTRY_AUTH_FILE belongs to the operator and survives");
  } finally {
    if (saved === undefined) delete process.env.REGISTRY_AUTH_FILE; else process.env.REGISTRY_AUTH_FILE = saved;
    fs.rmSync(fake.dir, { recursive: true, force: true });
  }
});

test("authAvailable does not log or expose credential contents", () => {
  const authFn = operatorsSource.slice(
    operatorsSource.indexOf("const authAvailable"),
    operatorsSource.indexOf("};", operatorsSource.indexOf("const authAvailable")) + 2
  );
  assert.ok(!authFn.includes("readFile"), "authAvailable must not read auth file contents");
  assert.ok(!authFn.includes("JSON.parse"), "authAvailable must not parse auth file contents");
  assert.ok(!authFn.includes("console.log"), "authAvailable must not log");
});

test("REGISTRY_AUTH_FILE absent returns false (functional)", async () => {
  const saved = process.env.REGISTRY_AUTH_FILE;
  delete process.env.REGISTRY_AUTH_FILE;
  try {
    const { authAvailable } = await import("../src/operators.js");
    assert.strictEqual(authAvailable(), false);
  } finally {
    if (saved !== undefined) process.env.REGISTRY_AUTH_FILE = saved;
  }
});

test("REGISTRY_AUTH_FILE pointing to missing path returns false (functional)", async () => {
  const saved = process.env.REGISTRY_AUTH_FILE;
  process.env.REGISTRY_AUTH_FILE = "/tmp/nonexistent-auth-file-" + Date.now();
  try {
    const { authAvailable } = await import("../src/operators.js");
    assert.strictEqual(authAvailable(), false);
  } finally {
    if (saved !== undefined) process.env.REGISTRY_AUTH_FILE = saved;
    else delete process.env.REGISTRY_AUTH_FILE;
  }
});

test("REGISTRY_AUTH_FILE pointing to existing file returns true (functional)", async () => {
  const tmpAuth = `/tmp/test-auth-available-${Date.now()}.json`;
  fs.writeFileSync(tmpAuth, JSON.stringify({ auths: {} }));
  const saved = process.env.REGISTRY_AUTH_FILE;
  process.env.REGISTRY_AUTH_FILE = tmpAuth;
  try {
    const { authAvailable } = await import("../src/operators.js");
    assert.strictEqual(authAvailable(), true);
  } finally {
    if (saved !== undefined) process.env.REGISTRY_AUTH_FILE = saved;
    else delete process.env.REGISTRY_AUTH_FILE;
    fs.unlinkSync(tmpAuth);
  }
});

test("index.js strips REGISTRY_AUTH_FILE from oc-mirror child env at both spawn sites", () => {
  const indexSource = fs.readFileSync(path.join(__dirname, "../src/index.js"), "utf8");
  const occurrences = indexSource.split("REGISTRY_AUTH_FILE: _drop").length - 1;
  assert.ok(
    occurrences >= 2,
    `index.js must strip REGISTRY_AUTH_FILE at both oc-mirror spawn sites (run + retry), found ${occurrences}`
  );
});

test("unrelated env vars survive REGISTRY_AUTH_FILE stripping", () => {
  const { REGISTRY_AUTH_FILE: _drop, ...filtered } = {
    REGISTRY_AUTH_FILE: "/tmp/auth.json",
    PATH: "/usr/bin",
    HOME: "/home/test",
    NODE_ENV: "test"
  };
  assert.strictEqual(filtered.PATH, "/usr/bin");
  assert.strictEqual(filtered.HOME, "/home/test");
  assert.strictEqual(filtered.NODE_ENV, "test");
  assert.strictEqual(filtered.REGISTRY_AUTH_FILE, undefined);
});
