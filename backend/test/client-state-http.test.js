/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { test } from "node:test";
import assert from "node:assert";
import { app } from "../src/index.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

test("GET /api/bundle.zip without token returns 400", async () => {
  const { server, baseUrl } = await createTestServer(app);
  try {
    const res = await fetch(`${baseUrl}/api/bundle.zip`);
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.ok(String(body.error || "").includes("token"));
  } finally {
    await closeTestServer(server);
  }
});

test("POST /api/generate rejects array state", async () => {
  const { server, baseUrl } = await createTestServer(app);
  try {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: [] })
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.ok(String(body.error || "").length > 0);
  } finally {
    await closeTestServer(server);
  }
});

test("POST /api/bundle.prepare rejects array state", async () => {
  const { server, baseUrl } = await createTestServer(app);
  try {
    const res = await fetch(`${baseUrl}/api/bundle.prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: [] })
    });
    assert.strictEqual(res.status, 400);
  } finally {
    await closeTestServer(server);
  }
});
