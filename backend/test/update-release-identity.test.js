/**
 * OpenShift Airgap Architect - Test Suite
 *
 * Release-identity boundary for the update check.
 *
 * The update check asks GitHub for the newest COMMIT on a branch
 * (`/repos/:repo/commits?sha=<branch>`) and sets `isOutdated` whenever that commit
 * differs from the running build. A differing commit is not evidence of a newer
 * published, supported release:
 *
 *   - this repository has ZERO published GitHub Releases (`GET /releases` -> []),
 *     so "a newer release exists" is not a statement the app can currently make;
 *   - `main` points at the v1.7.1 commit, so a v2.1 build compared against it is
 *     flagged "outdated" against something five months OLDER than itself;
 *   - a tag is not a release either - `v2.0.0` is tagged but unpublished.
 *
 * So the states are kept distinct and only a verified release identity may produce
 * the urgent state. No trusted release-identity source is implemented yet, so
 * production resolves `releaseIdentity: null` and the urgent state is unreachable
 * by construction - proven by the endpoint test at the bottom.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { test } from "node:test";
import assert from "node:assert";
import { app, clearUpdateInfoCache } from "../src/index.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";
import {
  UPDATE_STATUS,
  resolveUpdateStatus,
  isUrgentUpdateStatus
} from "../../shared/updateStatus.js";

const SHA_RUNNING = "e0944b5904c4824e22ac188b2069b498781bab99";
const SHA_BRANCH = "ffed74d0807d7a3bfcd321b660d7145b6d43b44d";

test("resolveUpdateStatus: checks disabled", () => {
  const status = resolveUpdateStatus({ disabled: true, currentSha: SHA_RUNNING });
  assert.strictEqual(status, UPDATE_STATUS.DISABLED);
  assert.strictEqual(isUrgentUpdateStatus(status), false);
});

test("resolveUpdateStatus: unknown build SHA cannot be compared", () => {
  for (const currentSha of ["", null, undefined, "unknown", "UNKNOWN"]) {
    const status = resolveUpdateStatus({ currentSha, latestSha: SHA_BRANCH });
    assert.strictEqual(status, UPDATE_STATUS.UNKNOWN, `currentSha=${String(currentSha)}`);
    assert.strictEqual(isUrgentUpdateStatus(status), false);
  }
});

test("resolveUpdateStatus: a failed lookup is offline, never an update prompt", () => {
  const status = resolveUpdateStatus({
    currentSha: SHA_RUNNING,
    fetchError: "Request timed out"
  });
  assert.strictEqual(status, UPDATE_STATUS.OFFLINE);
  assert.strictEqual(isUrgentUpdateStatus(status), false);
});

test("resolveUpdateStatus: identical SHAs are up to date", () => {
  const status = resolveUpdateStatus({ currentSha: SHA_RUNNING, latestSha: SHA_RUNNING });
  assert.strictEqual(status, UPDATE_STATUS.UP_TO_DATE);
  assert.strictEqual(isUrgentUpdateStatus(status), false);
});

test("resolveUpdateStatus: a differing branch commit is development-branch-ahead, NOT a published update", () => {
  // This is the exact real-world shape: a v2.1 build vs the v1.7.1 commit on main.
  const status = resolveUpdateStatus({ currentSha: SHA_RUNNING, latestSha: SHA_BRANCH });
  assert.strictEqual(status, UPDATE_STATUS.DEVELOPMENT_BRANCH_AHEAD);
  assert.strictEqual(
    isUrgentUpdateStatus(status),
    false,
    "a branch commit difference must never raise the urgent update banner"
  );
});

test("resolveUpdateStatus: an UNVERIFIED release identity is refused", () => {
  // Fail closed: anything that has not been through a trusted verification path
  // is treated as no release identity at all.
  const status = resolveUpdateStatus({
    currentSha: SHA_RUNNING,
    latestSha: SHA_BRANCH,
    releaseIdentity: { verified: false, version: "9.9.9", tag: "v9.9.9" }
  });
  assert.strictEqual(status, UPDATE_STATUS.DEVELOPMENT_BRANCH_AHEAD);
  assert.strictEqual(isUrgentUpdateStatus(status), false);
});

test("resolveUpdateStatus: a VERIFIED newer release identity is the only urgent state", () => {
  // Synthetic fixture only. Nothing in production can construct this today.
  const status = resolveUpdateStatus({
    currentSha: SHA_RUNNING,
    latestSha: SHA_BRANCH,
    releaseIdentity: {
      verified: true,
      isNewer: true,
      version: "2.2.0",
      tag: "v2.2.0",
      publishedAt: "2026-11-01T00:00:00Z"
    }
  });
  assert.strictEqual(status, UPDATE_STATUS.PUBLISHED_SUPPORTED_UPDATE);
  assert.strictEqual(isUrgentUpdateStatus(status), true);
});

test("resolveUpdateStatus: a verified release identity that is NOT newer is up to date", () => {
  const status = resolveUpdateStatus({
    currentSha: SHA_RUNNING,
    latestSha: SHA_RUNNING,
    releaseIdentity: { verified: true, isNewer: false, version: "2.1.0", tag: "v2.1.0" }
  });
  assert.strictEqual(status, UPDATE_STATUS.UP_TO_DATE);
  assert.strictEqual(isUrgentUpdateStatus(status), false);
});

test("GET /api/update-info exposes updateStatus and never the urgent state in production", async () => {
  const prevCheck = process.env.CHECK_UPDATES;
  const prevSha = process.env.APP_GIT_SHA;
  process.env.CHECK_UPDATES = "1";
  process.env.APP_GIT_SHA = SHA_RUNNING;
  clearUpdateInfoCache();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => {
    if (String(url).includes("api.github.com")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([{ sha: SHA_BRANCH }])
      });
    }
    return originalFetch(url, opts);
  };

  const { server, baseUrl } = await createTestServer(app);
  try {
    const res = await fetch(`${baseUrl}/api/update-info`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();

    assert.strictEqual(data.updateStatus, UPDATE_STATUS.DEVELOPMENT_BRANCH_AHEAD);
    assert.notStrictEqual(
      data.updateStatus,
      UPDATE_STATUS.PUBLISHED_SUPPORTED_UPDATE,
      "no trusted release-identity source exists, so this state must be unreachable"
    );
    // The endpoint must say plainly that it consulted no release-identity source,
    // rather than leaving the client to infer it.
    assert.strictEqual(data.releaseIdentity, null);
    assert.strictEqual(data.urgent, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (prevCheck !== undefined) process.env.CHECK_UPDATES = prevCheck;
    else delete process.env.CHECK_UPDATES;
    if (prevSha !== undefined) process.env.APP_GIT_SHA = prevSha;
    else delete process.env.APP_GIT_SHA;
    await closeTestServer(server);
  }
});

test("GET /api/update-info reports offline rather than an update when GitHub is unreachable", async () => {
  const prevCheck = process.env.CHECK_UPDATES;
  const prevSha = process.env.APP_GIT_SHA;
  process.env.CHECK_UPDATES = "1";
  process.env.APP_GIT_SHA = SHA_RUNNING;
  clearUpdateInfoCache();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => {
    if (String(url).includes("api.github.com")) return Promise.reject(new Error("ENETUNREACH"));
    return originalFetch(url, opts);
  };

  const { server, baseUrl } = await createTestServer(app);
  try {
    const res = await fetch(`${baseUrl}/api/update-info`);
    const data = await res.json();
    assert.strictEqual(data.updateStatus, UPDATE_STATUS.OFFLINE);
    assert.strictEqual(data.urgent, false);
    assert.strictEqual(data.isOutdated, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (prevCheck !== undefined) process.env.CHECK_UPDATES = prevCheck;
    else delete process.env.CHECK_UPDATES;
    if (prevSha !== undefined) process.env.APP_GIT_SHA = prevSha;
    else delete process.env.APP_GIT_SHA;
    await closeTestServer(server);
  }
});

test("GET /api/update-info reports disabled without contacting GitHub", async () => {
  const prev = process.env.CHECK_UPDATES;
  process.env.CHECK_UPDATES = "false";
  clearUpdateInfoCache();

  let githubCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => {
    if (String(url).includes("api.github.com")) {
      githubCalls++;
      return Promise.resolve({ ok: true, json: () => Promise.resolve([{ sha: SHA_BRANCH }]) });
    }
    return originalFetch(url, opts);
  };

  const { server, baseUrl } = await createTestServer(app);
  try {
    const res = await fetch(`${baseUrl}/api/update-info`);
    const data = await res.json();
    assert.strictEqual(data.updateStatus, UPDATE_STATUS.DISABLED);
    assert.strictEqual(data.urgent, false);
    assert.strictEqual(githubCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (prev !== undefined) process.env.CHECK_UPDATES = prev;
    else delete process.env.CHECK_UPDATES;
    await closeTestServer(server);
  }
});
