/**
 * F19 (v2.2.0 M5) — POST /api/operators/confirm locks only a complete release.
 *
 * It used to confirm whatever the server held: with nothing selected it stored
 * `confirmed: true` with no channel and no minor, POST /api/state then refused
 * every save ("Release cannot be confirmed without a channel") and generation
 * failed with 422 "OpenShift version could not be determined". Reproduced
 * through this API before the fix (lock 200 → generate 422).
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { app } from "../src/index.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

let server;
let baseUrl;

const call = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
};

const seed = async (release, version) => {
  await call("POST", "/api/start-over", {});
  const put = await call("POST", "/api/state", { release, version });
  assert.equal(put.status, 200);
};

describe("F19 — Install lock requires a complete release selection", () => {
  before(async () => { ({ server, baseUrl } = await createTestServer(app)); });
  after(async () => { await call("POST", "/api/start-over", {}); await closeTestServer(server); });

  test("nothing selected: 409, and the state stays unlocked", async () => {
    await seed({ channel: null, patchVersion: null, confirmed: false }, { _schemaVersion: 3, selectedMinor: null, selectedPatch: null, locked: false });
    const lock = await call("POST", "/api/operators/confirm", {});
    assert.equal(lock.status, 409);
    assert.equal(lock.json.code, "RELEASE_SELECTION_INCOMPLETE");
    const after = (await call("GET", "/api/state")).json;
    assert.equal(after.release.confirmed, false);
    assert.notEqual(after.version.locked, true);
  });

  test("a minor without a patch: 409", async () => {
    await seed({ channel: "4.22", patchVersion: null, confirmed: false }, { _schemaVersion: 3, selectedMinor: "4.22", selectedPatch: null, locked: false });
    const lock = await call("POST", "/api/operators/confirm", {});
    assert.equal(lock.status, 409);
    assert.equal((await call("GET", "/api/state")).json.release.confirmed, false);
  });

  test("a complete selection still locks (200)", async () => {
    await seed({ channel: "4.22", patchVersion: "4.22.3", confirmed: false }, { _schemaVersion: 3, selectedMinor: "4.22", selectedPatch: "4.22.3", locked: false });
    const lock = await call("POST", "/api/operators/confirm", {});
    assert.equal(lock.status, 200);
    assert.equal(lock.json.release.confirmed, true);
    assert.equal(lock.json.version.locked, true);
  });

  // An unsupported minor keeps its 422 precedence (the check runs before this
  // one); operator-version-guard.test.js covers it with state written directly,
  // because POST /api/state refuses to persist 4.23 in the first place.
});
