import { test } from "node:test";
import assert from "node:assert";
import http from "node:http";
import { app, clearUpdateInfoCache } from "../src/index.js";

function createTestServer() {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, port, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

test("GET /api/ready returns ready:true when DB is readable", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/ready`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ready, true);
  } finally {
    server.close();
  }
});

test("GET /api/build-info returns gitSha, buildTime, repo, branch", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/build-info`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok("gitSha" in data);
    assert.ok("buildTime" in data);
    assert.ok("repo" in data);
    assert.ok("branch" in data);
  } finally {
    server.close();
  }
});

test("GET /api/update-info when CHECK_UPDATES=false returns enabled:false", async () => {
  const prev = process.env.CHECK_UPDATES;
  process.env.CHECK_UPDATES = "false";
  clearUpdateInfoCache();
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/update-info`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.enabled, false);
  } finally {
    if (prev !== undefined) process.env.CHECK_UPDATES = prev;
    else delete process.env.CHECK_UPDATES;
    server.close();
  }
});

test("GET /api/update-info when APP_GIT_SHA is unknown returns isOutdated:false and does not treat as update available", async () => {
  const prevSha = process.env.APP_GIT_SHA;
  process.env.APP_GIT_SHA = "unknown";
  clearUpdateInfoCache();
  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => {
    if (String(url).includes("api.github.com")) {
      fetchCount++;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([{ sha: "6fc1c94abc123456789012345678901234567890" }])
      });
    }
    return originalFetch(url, opts);
  };
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/update-info`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.enabled, true);
    assert.strictEqual(data.isOutdated, false);
    assert.strictEqual(data.currentSha, "unknown");
    assert.ok(data.error);
    assert.strictEqual(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (prevSha !== undefined) process.env.APP_GIT_SHA = prevSha;
    else delete process.env.APP_GIT_SHA;
    server.close();
  }
});

test("GET /api/update-info when enabled and latest differs returns isOutdated:true", async () => {
  const prevCheck = process.env.CHECK_UPDATES;
  const prevSha = process.env.APP_GIT_SHA;
  process.env.CHECK_UPDATES = "1";
  process.env.APP_GIT_SHA = "oldsha12345678901234567890123456789012";
  clearUpdateInfoCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => {
    if (String(url).includes("api.github.com")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([{ sha: "newsha4567890123456789012345678901234" }])
      });
    }
    return originalFetch(url, opts);
  };
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/update-info`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.enabled, true);
    assert.strictEqual(data.isOutdated, true);
    assert.ok(data.latestSha);
  } finally {
    globalThis.fetch = originalFetch;
    if (prevCheck !== undefined) process.env.CHECK_UPDATES = prevCheck;
    else delete process.env.CHECK_UPDATES;
    if (prevSha !== undefined) process.env.APP_GIT_SHA = prevSha;
    else delete process.env.APP_GIT_SHA;
    server.close();
  }
});

test("GET /api/update-info when enabled and latest same returns isOutdated:false", async () => {
  const prevCheck = process.env.CHECK_UPDATES;
  const prevSha = process.env.APP_GIT_SHA;
  process.env.CHECK_UPDATES = "1";
  process.env.APP_GIT_SHA = "samesha123456789012345678901234567890";
  clearUpdateInfoCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => {
    if (String(url).includes("api.github.com")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([{ sha: "samesha123456789012345678901234567890" }])
      });
    }
    return originalFetch(url, opts);
  };
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/update-info`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.enabled, true);
    assert.strictEqual(data.isOutdated, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (prevCheck !== undefined) process.env.CHECK_UPDATES = prevCheck;
    else delete process.env.CHECK_UPDATES;
    if (prevSha !== undefined) process.env.APP_GIT_SHA = prevSha;
    else delete process.env.APP_GIT_SHA;
    server.close();
  }
});

test("update-info cache prevents repeated GitHub fetches", async () => {
  const prevCheck = process.env.CHECK_UPDATES;
  const prevSha = process.env.APP_GIT_SHA;
  process.env.CHECK_UPDATES = "1";
  process.env.APP_GIT_SHA = "cachesha123456789012345678901234567890";
  clearUpdateInfoCache();
  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => {
    if (String(url).includes("api.github.com")) {
      fetchCount++;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([{ sha: "cachesha123456789012345678901234567890" }])
      });
    }
    return originalFetch(url, opts);
  };
  const { server, baseUrl } = await createTestServer();
  try {
    const res1 = await fetch(`${baseUrl}/api/update-info`);
    assert.strictEqual(res1.status, 200);
    const res2 = await fetch(`${baseUrl}/api/update-info`);
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(fetchCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (prevCheck !== undefined) process.env.CHECK_UPDATES = prevCheck;
    else delete process.env.CHECK_UPDATES;
    if (prevSha !== undefined) process.env.APP_GIT_SHA = prevSha;
    else delete process.env.APP_GIT_SHA;
    server.close();
  }
});

test("update-info caches failure and returns error", async () => {
  const prevCheck = process.env.CHECK_UPDATES;
  const prevSha = process.env.APP_GIT_SHA;
  process.env.CHECK_UPDATES = "1";
  process.env.APP_GIT_SHA = "failsha123456789012345678901234567890";
  clearUpdateInfoCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => {
    if (String(url).includes("api.github.com")) {
      return Promise.reject(new Error("network error"));
    }
    return originalFetch(url, opts);
  };
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/update-info`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.enabled, true);
    assert.ok(data.error);
    assert.strictEqual(data.isOutdated, false);
    const res2 = await fetch(`${baseUrl}/api/update-info`);
    assert.strictEqual(res2.status, 200);
    const data2 = await res2.json();
    assert.ok(data2.error);
  } finally {
    globalThis.fetch = originalFetch;
    if (prevCheck !== undefined) process.env.CHECK_UPDATES = prevCheck;
    else delete process.env.CHECK_UPDATES;
    if (prevSha !== undefined) process.env.APP_GIT_SHA = prevSha;
    else delete process.env.APP_GIT_SHA;
    server.close();
  }
});
