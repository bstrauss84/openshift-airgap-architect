import { test } from "node:test";
import assert from "node:assert";
import http from "node:http";
import { app, resetStateForTests } from "../src/index.js";

function createTestServer() {
  return new Promise((resolve) => {
    resetStateForTests();
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

test("GET /api/profile/capabilities returns profile contract", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/profile/capabilities`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.profile);
    assert.ok(body.capabilities);
    assert.ok(Object.prototype.hasOwnProperty.call(body.capabilities, "releaseRefreshAllowed"));
  } finally {
    server.close();
  }
});

test("disconnected profile blocks connected-only refresh routes", async () => {
  const { server, baseUrl } = await createTestServer();
  const prev = process.env.AIRGAP_RUNTIME_SIDE;
  process.env.AIRGAP_RUNTIME_SIDE = "high-side";
  try {
    const refreshRes = await fetch(`${baseUrl}/api/cincinnati/update`, { method: "POST" });
    assert.strictEqual(refreshRes.status, 403);
    const payload = await refreshRes.json();
    assert.match(payload.error || "", /disconnected-execution/i);
  } finally {
    if (prev == null) delete process.env.AIRGAP_RUNTIME_SIDE;
    else process.env.AIRGAP_RUNTIME_SIDE = prev;
    server.close();
  }
});

test("bundle.zip includes readiness manifest and installer error artifact", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const bundleState = {
      version: { versionConfirmed: true },
      release: { channel: "stable-4.20", patchVersion: "4.20.0" },
      exportOptions: {
        includeCredentials: false,
        includeCertificates: true,
        includeClientTools: false,
        includeInstaller: true,
        installerTargetArch: "aarch64"
      }
    };
    const res = await fetch(`${baseUrl}/api/bundle.zip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: bundleState })
    });
    assert.strictEqual(res.status, 200);
    const contentType = res.headers.get("content-type") || "";
    assert.match(contentType, /application\/zip/);
    const bytes = Buffer.from(await res.arrayBuffer());
    const text = bytes.toString("latin1");
    assert.match(text, /EXPORT_READINESS_MANIFEST\.json/);
    assert.match(text, /tools\/openshift-install\.ERROR\.txt/);
  } finally {
    server.close();
  }
});

test("bundle.prepare token supports repeated native streamed downloads during TTL", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const bundleState = {
      version: { versionConfirmed: true },
      release: { channel: "stable-4.20", patchVersion: "4.20.0" },
      exportOptions: {
        includeCredentials: false,
        includeCertificates: true,
        includeClientTools: false,
        includeInstaller: false
      }
    };
    const prepRes = await fetch(`${baseUrl}/api/bundle.prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: bundleState })
    });
    assert.strictEqual(prepRes.status, 200);
    const prep = await prepRes.json();
    assert.ok(prep.token);

    const first = await fetch(`${baseUrl}/api/bundle.zip?token=${encodeURIComponent(prep.token)}`);
    assert.strictEqual(first.status, 200);
    assert.match(first.headers.get("content-type") || "", /application\/zip/);

    const second = await fetch(`${baseUrl}/api/bundle.zip?token=${encodeURIComponent(prep.token)}`);
    assert.strictEqual(second.status, 200);
  } finally {
    server.close();
  }
});
