/**
 * v2.2.0 local version freeze (2026-11-04): the source reports its own version
 * (VERSION, synchronized into package.json) while the newest PUBLISHED release
 * is older. That must read as "up to date" — never as an available update, and
 * never as if the installed version were itself a published release. Build
 * identity must not invent a Git SHA or build time.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { app, clearUpdateInfoCache } from "../src/index.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

const REPO = "bstrauss84/openshift-airgap-architect";
const VERSION = fs.readFileSync(new URL("../../VERSION", import.meta.url), "utf-8").trim();

const release = (tag) => ({
  url: `https://api.github.com/repos/${REPO}/releases/${tag.replace(/\D/g, "")}`,
  html_url: `https://github.com/${REPO}/releases/tag/${tag}`,
  tag_name: tag, name: `OpenShift Airgap Architect ${tag}`, draft: false, prerelease: false,
  published_at: "2026-10-23T15:04:06Z", target_commitish: "main"
});

async function withServer(env, github, fn) {
  const keys = ["CHECK_UPDATES", "APP_GIT_SHA", "APP_BUILD_TIME", "APP_REPO", "APP_BRANCH"];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  clearUpdateInfoCache();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => (String(url).includes("api.github.com") ? Promise.resolve(github(String(url))) : realFetch(url, opts));
  const { server, baseUrl } = await createTestServer(app);
  try {
    return await fn((p) => realFetch(`${baseUrl}${p}`).then((r) => r.json()));
  } finally {
    globalThis.fetch = realFetch;
    await closeTestServer(server);
    for (const k of keys) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
    clearUpdateInfoCache();
  }
}

test("the application reports exactly the VERSION file, a stable release identity", async () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
  assert.equal(pkg.version, VERSION);
  await withServer({}, () => ({ ok: true, status: 200, headers: new Headers(), json: () => Promise.resolve([]) }), async (get) => {
    const b = await get("/api/build-info");
    assert.equal(b.version, VERSION);
    assert.equal(b.gitSha, "unknown", "no Git SHA is invented when none was supplied");
    assert.equal(b.buildTime, "unknown", "no build time is invented when none was supplied");
  });
});

test("a candidate newer than every published release is 'up to date', not an update and not itself 'published'", async () => {
  const published = ["v2.1.0", "v2.1.1", "v2.1.2"].map(release);
  await withServer({}, () => ({ ok: true, status: 200, headers: new Headers(), json: () => Promise.resolve(published) }), async (get) => {
    const info = await get("/api/update-info");
    assert.equal(info.installedVersion, VERSION);
    assert.equal(info.updateStatus, "up-to-date");
    assert.equal(info.urgent, false);
    assert.equal(info.releaseIdentity.latest.version, "2.1.2", "the latest PUBLISHED release is reported as such");
    assert.ok(!JSON.stringify(info).includes(`releases/tag/v${VERSION}`), "no release URL for the installed version is fabricated");
  });
});
