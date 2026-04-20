import { test } from "node:test";
import assert from "node:assert";
import http from "node:http";
import { app } from "../src/index.js";

function createTestServer() {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

test("GET /api/bundle.zip without token returns 400", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/bundle.zip`);
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.ok(String(body.error || "").includes("token"));
  } finally {
    server.close();
  }
});

test("POST /api/generate rejects array state", async () => {
  const { server, baseUrl } = await createTestServer();
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
    server.close();
  }
});

test("POST /api/bundle.prepare rejects array state", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/bundle.prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: [] })
    });
    assert.strictEqual(res.status, 400);
  } finally {
    server.close();
  }
});
