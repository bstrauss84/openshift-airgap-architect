/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { test } from "node:test";
import assert from "node:assert";
import { app, clearUpdateInfoCache } from "../src/index.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

test("GET /api/ready returns ready:true when DB is readable", async () => {
  const { server, baseUrl } = await createTestServer(app);
  try {
    const res = await fetch(`${baseUrl}/api/ready`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ready, true);
  } finally {
    await closeTestServer(server);
  }
});

test("GET /api/build-info returns gitSha, buildTime, repo, branch", async () => {
  const { server, baseUrl } = await createTestServer(app);
  try {
    const res = await fetch(`${baseUrl}/api/build-info`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok("gitSha" in data);
    assert.ok("buildTime" in data);
    assert.ok("repo" in data);
    assert.ok("branch" in data);
  } finally {
    await closeTestServer(server);
  }
});

test("GET /api/update-info when CHECK_UPDATES=false returns enabled:false", async () => {
  const prev = process.env.CHECK_UPDATES;
  process.env.CHECK_UPDATES = "false";
  clearUpdateInfoCache();
  const { server, baseUrl } = await createTestServer(app);
  try {
    const res = await fetch(`${baseUrl}/api/update-info`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.enabled, false);
  } finally {
    if (prev !== undefined) process.env.CHECK_UPDATES = prev;
    else delete process.env.CHECK_UPDATES;
    await closeTestServer(server);
  }
});

// v2.1.1: the update check compares the installed package.json version with the
// newest published GitHub Release. The Git SHA is provenance only. Exhaustive
// coverage lives in update-release-identity.test.js; these keep the original
// endpoint contracts (no fetch when impossible, outdated, same, caching).

const RELEASES_REPO = "bstrauss84/openshift-airgap-architect";
const releaseEntry = (tag) => ({
  url: `https://api.github.com/repos/${RELEASES_REPO}/releases/1`,
  html_url: `https://github.com/${RELEASES_REPO}/releases/tag/${tag}`,
  tag_name: tag,
  draft: false,
  prerelease: false,
  published_at: "2026-10-21T16:30:53Z"
});
const okJson = (body) => Promise.resolve({ ok: true, status: 200, headers: new Headers(), json: () => Promise.resolve(body) });

async function withUpdateEnv(env, githubImpl, fn) {
  const keys = ["CHECK_UPDATES", "APP_GIT_SHA", "APP_REPO"];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  clearUpdateInfoCache();
  const counter = { count: 0 };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => {
    if (String(url).includes("api.github.com")) {
      counter.count++;
      return githubImpl(String(url));
    }
    return originalFetch(url, opts);
  };
  const { server, baseUrl } = await createTestServer(app);
  try {
    await fn({ baseUrl, counter, get: async () => (await originalFetch(`${baseUrl}/api/update-info`)).json() });
  } finally {
    globalThis.fetch = originalFetch;
    for (const k of keys) {
      if (prev[k] !== undefined) process.env[k] = prev[k];
      else delete process.env[k];
    }
    clearUpdateInfoCache();
    await closeTestServer(server);
  }
}

test("GET /api/update-info when APP_GIT_SHA is unknown still checks published releases", async () => {
  await withUpdateEnv({ APP_GIT_SHA: "unknown" }, () => okJson([releaseEntry("v99.0.0")]), async ({ get, counter }) => {
    const data = await get();
    assert.strictEqual(data.enabled, true);
    assert.strictEqual(data.currentSha, "unknown");
    assert.strictEqual(data.isOutdated, true);
    assert.strictEqual(data.error, null);
    assert.strictEqual(counter.count, 1);
  });
});

test("GET /api/update-info when a newer release is published returns isOutdated:true", async () => {
  await withUpdateEnv({ CHECK_UPDATES: "1" }, () => okJson([releaseEntry("v99.0.0")]), async ({ get }) => {
    const data = await get();
    assert.strictEqual(data.enabled, true);
    assert.strictEqual(data.isOutdated, true);
    assert.strictEqual(data.releaseIdentity.latest.tag, "v99.0.0");
  });
});

test("GET /api/update-info when only an older release is published returns isOutdated:false", async () => {
  await withUpdateEnv({ CHECK_UPDATES: "1" }, () => okJson([releaseEntry("v0.0.1")]), async ({ get }) => {
    const data = await get();
    assert.strictEqual(data.enabled, true);
    assert.strictEqual(data.isOutdated, false);
    assert.strictEqual(data.error, null);
  });
});

test("update-info cache prevents repeated GitHub fetches", async () => {
  await withUpdateEnv({ CHECK_UPDATES: "1" }, () => okJson([releaseEntry("v0.0.1")]), async ({ get, counter }) => {
    await get();
    await get();
    assert.strictEqual(counter.count, 1);
  });
});

test("update-info caches failure and returns error", async () => {
  await withUpdateEnv({ CHECK_UPDATES: "1" }, () => Promise.reject(new Error("network error")), async ({ get, counter }) => {
    const data = await get();
    assert.strictEqual(data.enabled, true);
    assert.ok(data.error);
    assert.strictEqual(data.isOutdated, false);
    const data2 = await get();
    assert.ok(data2.error);
    assert.strictEqual(counter.count, 1);
  });
});
