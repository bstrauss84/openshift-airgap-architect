/**
 * v2.2.0 M2 — POST /api/mirroring/active: the Mirroring UI's open profile is
 * stored server-side so it survives a reload. It changes nothing else, refuses
 * unknown ids and accepts null.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/index.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

let server;
let baseUrl;
const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};

before(async () => {
  ({ server, baseUrl } = await createTestServer(app));
  await api("POST", "/api/mirroring/start-over", {});
});
after(async () => closeTestServer(server));

test("selects, clears and refuses unknown profiles without touching profile data", async () => {
  const a = (await api("POST", "/api/mirroring/profiles", { name: "a", content: { additionalImages: true }, additionalImages: ["quay.io/a/b:1"] })).json;
  const b = (await api("POST", "/api/mirroring/profiles", { name: "b" })).json;
  assert.equal((await api("GET", "/api/mirroring")).json.activeProfileId, b.id, "create opens the new profile");

  const sel = await api("POST", "/api/mirroring/active", { profileId: a.id });
  assert.equal(sel.status, 200);
  assert.equal(sel.json.activeProfileId, a.id);
  const stored = sel.json.profiles.find((p) => p.id === a.id);
  assert.equal(stored.name, "a");
  assert.deepEqual(stored.additionalImages, [{ id: "img-legacy0", name: "quay.io/a/b:1", source: "user" }]);

  assert.equal((await api("POST", "/api/mirroring/active", { profileId: "p-doesnotexist00" })).status, 404);
  assert.equal((await api("POST", "/api/mirroring/active", { profileId: "../../etc" })).status, 404);
  assert.equal((await api("POST", "/api/mirroring/active", { profileId: a.id, extra: 1 })).status, 400);
  assert.equal((await api("GET", "/api/mirroring")).json.activeProfileId, a.id, "refused requests change nothing");

  const cleared = await api("POST", "/api/mirroring/active", { profileId: null });
  assert.equal(cleared.json.activeProfileId, null);
  assert.equal(cleared.json.profiles.length, 2);
});
