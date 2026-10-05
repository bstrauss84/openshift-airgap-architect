import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
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

test("operator scan passes --authfile flag when auth is available", () => {
  assert.ok(
    operatorsSource.includes("--authfile="),
    "operators.js must pass --authfile flag to oc-mirror v2"
  );
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

test("operator scan child env strips REGISTRY_AUTH_FILE before spawn", () => {
  assert.ok(
    operatorsSource.includes("REGISTRY_AUTH_FILE: _drop"),
    "operators.js must destructure REGISTRY_AUTH_FILE out of process.env before spawning oc-mirror"
  );
  const spawnIdx = operatorsSource.indexOf("spawn(bin, args,");
  assert.ok(spawnIdx > 0, "operators.js must contain a spawn call");
  const envArgMatch = operatorsSource.slice(spawnIdx, spawnIdx + 80);
  assert.ok(
    envArgMatch.includes("{ env }") || envArgMatch.includes("{env}"),
    "spawn must pass the env object (which has REGISTRY_AUTH_FILE stripped)"
  );
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
