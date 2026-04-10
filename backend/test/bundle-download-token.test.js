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

test("bundle token remains valid for repeated GETs during TTL", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const state = {
      version: { versionConfirmed: true },
      release: { channel: "stable-4.20", patchVersion: "4.20.0", confirmed: true },
      exportOptions: { includeClientTools: false, includeInstaller: false, includeCertificates: false }
    };

    const prepRes = await fetch(`${baseUrl}/api/bundle.prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state })
    });
    assert.strictEqual(prepRes.status, 200);
    const prep = await prepRes.json();
    assert.ok(prep.token);

    const first = await fetch(`${baseUrl}/api/bundle.zip?token=${encodeURIComponent(prep.token)}`);
    assert.strictEqual(first.status, 200);
    const firstBytes = Buffer.from(await first.arrayBuffer());
    assert.strictEqual(firstBytes[0], 0x50);
    assert.strictEqual(firstBytes[1], 0x4b);

    const second = await fetch(`${baseUrl}/api/bundle.zip?token=${encodeURIComponent(prep.token)}`);
    assert.strictEqual(second.status, 200);
    const secondBytes = Buffer.from(await second.arrayBuffer());
    assert.strictEqual(secondBytes[0], 0x50);
    assert.strictEqual(secondBytes[1], 0x4b);
  } finally {
    server.close();
  }
});
