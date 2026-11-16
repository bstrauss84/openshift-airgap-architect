import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

const echoApp = (req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, url: req.url }));
};

describe("httpServerLifecycle helper", () => {
  it("createTestServer resolves with server, port, and baseUrl", async () => {
    const result = await createTestServer(echoApp);
    assert.ok(result.server instanceof http.Server);
    assert.strictEqual(typeof result.port, "number");
    assert.ok(result.port > 0);
    assert.strictEqual(result.baseUrl, `http://127.0.0.1:${result.port}`);
    assert.strictEqual(result.server.listening, true);
    await closeTestServer(result.server);
  });

  it("request succeeds and response body is consumable", async () => {
    const { server, baseUrl } = await createTestServer(echoApp);
    try {
      const res = await fetch(`${baseUrl}/test`);
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.ok, true);
      assert.strictEqual(body.url, "/test");
    } finally {
      await closeTestServer(server);
    }
  });

  it("closeTestServer resolves and leaves server.listening false", async () => {
    const { server } = await createTestServer(echoApp);
    assert.strictEqual(server.listening, true);
    await closeTestServer(server);
    assert.strictEqual(server.listening, false);
  });

  it("repeated closeTestServer is deterministic (no error on second call)", async () => {
    const { server } = await createTestServer(echoApp);
    await closeTestServer(server);
    assert.strictEqual(server.listening, false);
    await closeTestServer(server);
    assert.strictEqual(server.listening, false);
  });

  it("createTestServer rejects on listen error", async () => {
    const blocker = http.createServer(echoApp);
    await new Promise(resolve => blocker.listen(0, "127.0.0.1", resolve));
    const blockedPort = blocker.address().port;

    const failServer = http.createServer(echoApp);
    try {
      await assert.rejects(
        () =>
          new Promise((resolve, reject) => {
            failServer.on("error", reject);
            failServer.listen(blockedPort, "127.0.0.1", () => resolve());
          }),
        { code: "EADDRINUSE" }
      );
    } finally {
      blocker.close();
    }
  });

  it("server handles request then closes cleanly", async () => {
    const { server, baseUrl } = await createTestServer(echoApp);

    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json();
    assert.strictEqual(body.ok, true);

    await closeTestServer(server);
    assert.strictEqual(server.listening, false);
  });
});
