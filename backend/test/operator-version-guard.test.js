import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { closeTestServer } from "./helpers/httpServerLifecycle.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_DATA_DIR = `/tmp/airgap-backend-test-op-version-guard-${Date.now()}-${process.pid}`;
const TEST_DB_PATH = path.join(TEST_DATA_DIR, "airgap-architect.db");

let testServer = null;
let baseUrl = null;
let originalDataDir = null;

async function startServer() {
  originalDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = TEST_DATA_DIR;
  process.env.NODE_ENV = "test";
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  const dummyAuthFile = path.join(TEST_DATA_DIR, "auth.json");
  fs.writeFileSync(dummyAuthFile, JSON.stringify({ auths: {} }));
  process.env.REGISTRY_AUTH_FILE = dummyAuthFile;

  const { app } = await import("../src/index.js");

  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function writeStateDirectly(state) {
  const db = new Database(TEST_DB_PATH);
  try {
    const stmt = db.prepare(`INSERT OR REPLACE INTO app_state (id, state_json, updated_at) VALUES ('singleton', ?, ?)`);
    stmt.run(JSON.stringify(state), Date.now());
  } finally {
    db.close();
  }
}

async function postJson(urlPath, body = {}) {
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => null),
  };
}

async function postState(state) {
  const response = await fetch(`${baseUrl}/api/state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

describe("Operator endpoints reject unsupported OCP versions", () => {
  before(async () => {
    const result = await startServer();
    testServer = result.server;
    baseUrl = result.baseUrl;
  });

  after(async () => {
    await closeTestServer(testServer);
    process.env.DATA_DIR = originalDataDir || "";
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  test("POST /api/operators/confirm returns 422 for unsupported 4.23 (state written directly)", async () => {
    writeStateDirectly({
      _schemaVersion: 3,
      release: { channel: "4.23", patchVersion: "4.23.1", confirmed: false },
      version: { _schemaVersion: 3, selectedMinor: "4.23", selectedPatch: "4.23.1", locked: false },
      methodology: { method: "Agent-Based Installer" },
      blueprint: { clusterName: "test", baseDomain: "example.com" },
    });
    const res = await postJson("/api/operators/confirm", {});
    assert.equal(res.status, 422, `expected 422, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body?.code, "UNSUPPORTED_VERSION");
  });

  test("POST /api/operators/scan returns 422 for unsupported 4.23 (state written directly)", async () => {
    writeStateDirectly({
      _schemaVersion: 3,
      release: { channel: "4.23", patchVersion: "4.23.1", confirmed: true },
      version: { _schemaVersion: 3, selectedMinor: "4.23", selectedPatch: "4.23.1", locked: true },
      methodology: { method: "Agent-Based Installer" },
      blueprint: { clusterName: "test", baseDomain: "example.com" },
    });
    const res = await postJson("/api/operators/scan", { pullSecret: '{"auths":{}}' });
    assert.equal(res.status, 422, `expected 422, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body?.code, "UNSUPPORTED_VERSION");
  });

  test("POST /api/operators/prefetch returns 422 for unsupported 4.23 (state written directly)", async () => {
    writeStateDirectly({
      _schemaVersion: 3,
      release: { channel: "4.23", patchVersion: "4.23.1", confirmed: true },
      version: { _schemaVersion: 3, selectedMinor: "4.23", selectedPatch: "4.23.1", locked: true },
      methodology: { method: "Agent-Based Installer" },
      blueprint: { clusterName: "test", baseDomain: "example.com" },
    });
    const res = await postJson("/api/operators/prefetch", {});
    assert.equal(res.status, 422, `expected 422, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body?.code, "UNSUPPORTED_VERSION");
  });

  test("POST /api/operators/confirm succeeds for supported 4.21", async () => {
    const postRes = await postState({
      _schemaVersion: 3,
      release: { channel: "4.21", patchVersion: "4.21.20", confirmed: false },
      version: { _schemaVersion: 3, selectedMinor: "4.21", selectedPatch: "4.21.20", locked: false },
      methodology: { method: "Agent-Based Installer" },
      blueprint: { clusterName: "test", baseDomain: "example.com" },
    });
    assert.equal(postRes.status, 200, `POST /api/state failed: ${JSON.stringify(postRes.body)}`);
    const res = await postJson("/api/operators/confirm", {});
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body?.ok, "confirm should succeed");
  });

  test("POST /api/state rejects 4.23 at persistence boundary", async () => {
    const postRes = await postState({
      _schemaVersion: 3,
      release: { channel: "4.23", patchVersion: "4.23.1" },
      version: { _schemaVersion: 3, selectedMinor: "4.23", selectedPatch: "4.23.1" },
      methodology: { method: "Agent-Based Installer" },
      blueprint: { clusterName: "test", baseDomain: "example.com" },
    });
    assert.equal(postRes.status, 422, `expected 422, got ${postRes.status}`);
    assert.equal(postRes.body?.code, "UNSUPPORTED_VERSION");
  });
});
