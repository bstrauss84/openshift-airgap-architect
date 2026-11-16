/**
 * OpenShift Airgap Architect - Test Suite
 *
 * Published-release update detection (v2.1.1).
 *
 * Root cause pinned here: v2.1.0 hardcoded `releaseIdentity: null` and also
 * returned `unknown` whenever the Git SHA was unknown (the Compose default), so the
 * update banner was unreachable in production. The contract is now: compare the
 * installed package.json version with the newest PUBLISHED, STABLE GitHub Release
 * of the configured repository. The Git SHA plays no part, and a branch commit is
 * never consulted.
 *
 * Endpoint tests drive the real GET /api/update-info route with a stubbed
 * api.github.com. They exercise the actual backend path but are not live GitHub
 * integration evidence.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { app, clearUpdateInfoCache } from "../src/index.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";
import {
  UPDATE_STATUS,
  resolveUpdateStatus,
  isUrgentUpdateStatus,
  isStableReleaseVersion,
  updateStatusOf
} from "../../shared/updateStatus.js";
import { buildUpdateInfo, parseReleaseIdentity } from "../src/releaseUpdateCheck.js";

const REPO = "bstrauss84/openshift-airgap-architect";
const INSTALLED = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf-8")).version;

/** Bump the patch of a stable X.Y.Z (test-only arithmetic on a known-good value). */
function bump(version, by) {
  const [maj, min, pat] = version.split(".").map(Number);
  return `${maj}.${min}.${Math.max(0, pat + by)}`;
}

function release(tag, overrides = {}) {
  return {
    url: `https://api.github.com/repos/${REPO}/releases/${Math.floor(Math.random() * 1e6)}`,
    html_url: `https://github.com/${REPO}/releases/tag/${tag}`,
    tag_name: tag,
    name: `OpenShift Airgap Architect ${tag}`,
    draft: false,
    prerelease: false,
    published_at: "2026-10-21T16:30:53Z",
    target_commitish: "main",
    ...overrides
  };
}

const okResponse = (body) => ({ ok: true, status: 200, headers: new Headers(), json: () => Promise.resolve(body) });

/** Run GET /api/update-info against a stubbed GitHub. */
async function getUpdateInfo({ env = {}, github }) {
  const keys = ["CHECK_UPDATES", "APP_GIT_SHA", "APP_REPO", "APP_BRANCH"];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  clearUpdateInfoCache();

  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => {
    if (String(url).includes("api.github.com")) {
      calls.push(String(url));
      return github(String(url));
    }
    return originalFetch(url, opts);
  };
  const { server, baseUrl } = await createTestServer(app);
  try {
    const res = await originalFetch(`${baseUrl}/api/update-info`);
    assert.strictEqual(res.status, 200);
    return { data: await res.json(), calls };
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

test("installed package version is a stable release version (precondition)", () => {
  assert.ok(isStableReleaseVersion(INSTALLED), `package.json version ${INSTALLED}`);
});

// 1
test("same installed and published version -> up to date, no banner", async () => {
  const { data } = await getUpdateInfo({ github: () => Promise.resolve(okResponse([release(`v${INSTALLED}`)])) });
  assert.strictEqual(data.updateStatus, UPDATE_STATUS.UP_TO_DATE);
  assert.strictEqual(data.urgent, false);
  assert.strictEqual(data.isOutdated, false);
  assert.strictEqual(data.installedVersion, INSTALLED);
  assert.strictEqual(data.releaseIdentity.latest.version, INSTALLED);
});

// 2
test("newer published stable release -> published-supported-update", async () => {
  const newer = bump(INSTALLED, 1);
  const { data, calls } = await getUpdateInfo({
    env: { APP_GIT_SHA: "e0944b5904c4824e22ac188b2069b498781bab99" },
    github: () => Promise.resolve(okResponse([release(`v${newer}`), release(`v${INSTALLED}`)]))
  });
  assert.strictEqual(data.updateStatus, UPDATE_STATUS.PUBLISHED_SUPPORTED_UPDATE);
  assert.strictEqual(data.urgent, true);
  assert.strictEqual(data.isOutdated, true);
  assert.strictEqual(data.releaseIdentity.verified, true);
  assert.strictEqual(data.releaseIdentity.source, "github-releases-api");
  assert.strictEqual(data.releaseIdentity.latest.version, newer);
  assert.strictEqual(data.releaseIdentity.latest.url, `https://github.com/${REPO}/releases/tag/v${newer}`);
  // The releases API is consulted, never the commits/branch endpoint.
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0], new RegExp(`/repos/${REPO}/releases\\?`));
  assert.doesNotMatch(calls[0], /commits/);
});

// 3
test("unknown Git SHA does NOT disable detection when the version is known", async () => {
  for (const sha of [undefined, "unknown", ""]) {
    const env = sha === undefined ? {} : { APP_GIT_SHA: sha };
    const { data, calls } = await getUpdateInfo({
      env,
      github: () => Promise.resolve(okResponse([release(`v${bump(INSTALLED, 1)}`)]))
    });
    assert.strictEqual(calls.length, 1, `sha=${String(sha)} must still query releases`);
    assert.strictEqual(data.currentSha, "unknown");
    assert.strictEqual(data.updateStatus, UPDATE_STATUS.PUBLISHED_SUPPORTED_UPDATE, `sha=${String(sha)}`);
  }
});

// 4
test("only an OLDER published release -> up to date, never a downgrade prompt", async () => {
  const older = INSTALLED.endsWith(".0") ? "0.0.1" : bump(INSTALLED, -1);
  const { data } = await getUpdateInfo({ github: () => Promise.resolve(okResponse([release(`v${older}`)])) });
  assert.strictEqual(data.updateStatus, UPDATE_STATUS.UP_TO_DATE);
  assert.strictEqual(data.urgent, false);
  assert.strictEqual(
    resolveUpdateStatus({
      installedVersion: "2.1.1",
      releaseIdentity: { verified: true, latest: { version: "2.1.0" } }
    }),
    UPDATE_STATUS.UP_TO_DATE
  );
});

// 5
test("a different branch commit with no newer release -> no banner (branch is not consulted)", async () => {
  const { data, calls } = await getUpdateInfo({
    env: { APP_GIT_SHA: "e0944b5904c4824e22ac188b2069b498781bab99", APP_BRANCH: "main" },
    github: (url) => url.includes("/commits")
      ? Promise.resolve(okResponse([{ sha: "ffed74d0807d7a3bfcd321b660d7145b6d43b44d" }]))
      : Promise.resolve(okResponse([release(`v${INSTALLED}`)]))
  });
  assert.strictEqual(data.updateStatus, UPDATE_STATUS.UP_TO_DATE);
  assert.strictEqual(data.urgent, false);
  assert.strictEqual(data.latestSha, null);
  assert.ok(calls.every((u) => !u.includes("/commits")));
});

// 6
test("draft and prerelease entries are ignored", async () => {
  const newer = bump(INSTALLED, 1);
  const { data } = await getUpdateInfo({
    github: () => Promise.resolve(okResponse([
      release(`v${newer}`, { draft: true }),
      release(`v${bump(INSTALLED, 2)}`, { prerelease: true }),
      release(`v${newer}-rc.1`),
      release(`v${INSTALLED}`)
    ]))
  });
  assert.strictEqual(data.updateStatus, UPDATE_STATUS.UP_TO_DATE);
  assert.strictEqual(data.releaseIdentity.latest.version, INSTALLED);
});

test("no eligible published release at all -> up to date, with latest null", async () => {
  const { data } = await getUpdateInfo({ github: () => Promise.resolve(okResponse([])) });
  assert.strictEqual(data.updateStatus, UPDATE_STATUS.UP_TO_DATE);
  assert.strictEqual(data.releaseIdentity.latest, null);
});

test("non-semver or two-part tags are not release identities", async () => {
  const { data } = await getUpdateInfo({
    github: () => Promise.resolve(okResponse([release("nightly"), release("v99.0"), release("latest")]))
  });
  assert.strictEqual(data.updateStatus, UPDATE_STATUS.UP_TO_DATE);
  assert.strictEqual(data.releaseIdentity.latest, null);
});

// 7
test("unknown or non-stable installed version fails closed without any request", async () => {
  for (const installedVersion of [undefined, "unknown", "", "2.0.0-dev", "2.1"]) {
    let calls = 0;
    const info = await buildUpdateInfo({
      env: {},
      installedVersion,
      fetchImpl: () => { calls++; return Promise.resolve(okResponse([release("v99.0.0")])); }
    });
    assert.strictEqual(info.updateStatus, UPDATE_STATUS.UNKNOWN, `installed=${String(installedVersion)}`);
    assert.strictEqual(info.urgent, false);
    assert.strictEqual(calls, 0);
  }
});

// 8
test("offline, timeout, HTTP error and rate limit -> offline, never up to date", async () => {
  const cases = [
    ["network", () => Promise.reject(new Error("ENETUNREACH")), /ENETUNREACH/],
    ["timeout", () => Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" })), /timed out/],
    ["500", () => Promise.resolve({ ok: false, status: 500, headers: new Headers() }), /GitHub API 500/],
    ["rate limit", () => Promise.resolve({ ok: false, status: 403, headers: new Headers({ "x-ratelimit-remaining": "0" }) }), /rate limit/],
    ["429", () => Promise.resolve({ ok: false, status: 429, headers: new Headers() }), /rate limit/]
  ];
  for (const [label, github, errorPattern] of cases) {
    const { data } = await getUpdateInfo({ github });
    assert.strictEqual(data.updateStatus, UPDATE_STATUS.OFFLINE, label);
    assert.notStrictEqual(data.updateStatus, UPDATE_STATUS.UP_TO_DATE, label);
    assert.strictEqual(data.urgent, false, label);
    assert.strictEqual(data.releaseIdentity, null, label);
    assert.match(data.error, errorPattern, label);
  }
});

// 9
test("CHECK_UPDATES=false|0 -> disabled with no GitHub request", async () => {
  for (const value of ["false", "0"]) {
    const { data, calls } = await getUpdateInfo({
      env: { CHECK_UPDATES: value },
      github: () => Promise.resolve(okResponse([release("v99.0.0")]))
    });
    assert.strictEqual(data.updateStatus, UPDATE_STATUS.DISABLED);
    assert.strictEqual(data.enabled, false);
    assert.strictEqual(data.urgent, false);
    assert.strictEqual(calls.length, 0);
  }
});

// 10
test("malformed metadata and foreign repository identity fail closed", async () => {
  const foreign = release("v99.0.0", {
    url: "https://api.github.com/repos/attacker/openshift-airgap-architect/releases/1",
    html_url: "https://github.com/attacker/openshift-airgap-architect/releases/tag/v99.0.0"
  });
  const cases = [
    ["object, not list", okResponse({ tag_name: "v99.0.0" })],
    ["null entry", okResponse([null])],
    ["foreign repository", okResponse([foreign, release(`v${INSTALLED}`)])],
    ["missing urls", okResponse([{ tag_name: "v99.0.0", draft: false, prerelease: false }])],
    ["not JSON", { ok: true, status: 200, headers: new Headers(), json: () => Promise.reject(new SyntaxError("bad")) }]
  ];
  for (const [label, response] of cases) {
    const { data } = await getUpdateInfo({ github: () => Promise.resolve(response) });
    assert.strictEqual(data.updateStatus, UPDATE_STATUS.OFFLINE, label);
    assert.strictEqual(data.urgent, false, label);
    assert.strictEqual(data.releaseIdentity, null, label);
  }
});

test("an invalid APP_REPO is refused without a request", async () => {
  const { data, calls } = await getUpdateInfo({
    env: { APP_REPO: "https://evil.example/x" },
    github: () => Promise.resolve(okResponse([]))
  });
  assert.strictEqual(data.updateStatus, UPDATE_STATUS.OFFLINE);
  assert.strictEqual(calls.length, 0);
});

test("release missing or with an unparseable published_at is ineligible", () => {
  const parsed = parseReleaseIdentity([
    release("v99.0.0", { published_at: null }),
    release("v98.0.0", { published_at: "not-a-date" })
  ], REPO);
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.releaseIdentity.latest, null);
});

test("repository identity comparison is case-insensitive (GitHub names are)", () => {
  const parsed = parseReleaseIdentity([release("v99.0.0")], "BStrauss84/OpenShift-Airgap-Architect");
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.releaseIdentity.latest.version, "99.0.0");
});

test("the highest semantic version wins regardless of list order", () => {
  const parsed = parseReleaseIdentity([release("v2.9.0"), release("v2.10.0"), release("v2.1.5")], REPO);
  assert.strictEqual(parsed.releaseIdentity.latest.version, "2.10.0");
});

// Resolver contract (shared by backend and frontend)

test("resolveUpdateStatus: newer-than is recomputed, not trusted from the payload", () => {
  const status = resolveUpdateStatus({
    installedVersion: "2.1.0",
    releaseIdentity: { verified: true, isNewer: true, latest: { version: "2.0.0" } }
  });
  assert.strictEqual(status, UPDATE_STATUS.UP_TO_DATE);
});

test("resolveUpdateStatus: an unverified identity is never an update", () => {
  const status = resolveUpdateStatus({
    installedVersion: "2.1.0",
    releaseIdentity: { verified: false, latest: { version: "9.9.9" } }
  });
  assert.strictEqual(status, UPDATE_STATUS.OFFLINE);
  assert.strictEqual(isUrgentUpdateStatus(status), false);
});

test("resolveUpdateStatus: a prerelease version in a verified identity is ignored", () => {
  const status = resolveUpdateStatus({
    installedVersion: "2.1.0",
    releaseIdentity: { verified: true, latest: { version: "2.2.0-rc.1" } }
  });
  assert.strictEqual(status, UPDATE_STATUS.UP_TO_DATE);
});

// 12
test("updateStatusOf: a legacy SHA-diff payload without updateStatus fails closed", () => {
  const status = updateStatusOf({
    enabled: true,
    isOutdated: true,
    currentSha: "e0944b5904c4824e22ac188b2069b498781bab99",
    latestSha: "ffed74d0807d7a3bfcd321b660d7145b6d43b44d",
    error: null
  });
  assert.notStrictEqual(status, UPDATE_STATUS.PUBLISHED_SUPPORTED_UPDATE);
  assert.notStrictEqual(status, UPDATE_STATUS.UP_TO_DATE);
});

test("update-info caches a successful lookup", async () => {
  const keys = ["CHECK_UPDATES", "APP_GIT_SHA", "APP_REPO"];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  clearUpdateInfoCache();
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => {
    if (String(url).includes("api.github.com")) { calls++; return Promise.resolve(okResponse([release(`v${INSTALLED}`)])); }
    return originalFetch(url, opts);
  };
  const { server, baseUrl } = await createTestServer(app);
  try {
    await originalFetch(`${baseUrl}/api/update-info`);
    await originalFetch(`${baseUrl}/api/update-info`);
    assert.strictEqual(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    for (const k of keys) { if (prev[k] !== undefined) process.env[k] = prev[k]; }
    clearUpdateInfoCache();
    await closeTestServer(server);
  }
});
