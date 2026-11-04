/**
 * v2.2.0 R-UX09 — DRAFT preview for a profile that is not ready.
 *
 * The validated preview, download and runs keep refusing an unready profile
 * (PROFILE_NOT_READY). The draft route renders what the current selection
 * gives with the SAME generator and schema check, labelled DRAFT with its
 * blockers, inventing nothing; once the profile is ready the draft route
 * refuses and the validated preview's body equals the draft's body.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/index.js";
import { createTestServer, closeTestServer } from "./helpers/httpServerLifecycle.js";

let server;
let baseUrl;
const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const create = async (body) => {
  const r = await api("POST", "/api/mirroring/profiles", { name: `draft ${Math.random()}`, ...body });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json;
};
const body = (yaml) => yaml.split("\n").filter((l) => !l.startsWith("# ")).join("\n");

before(async () => { ({ server, baseUrl } = await createTestServer(app)); });
after(async () => { await closeTestServer(server); });

describe("draft preview (R-UX09)", () => {
  test("platform selected but not locked: the validated preview refuses; the draft shows the selected release, labelled DRAFT with the blocker", async () => {
    const p = await create({ content: { platform: true }, platform: { release: { channel: "4.22", patchVersion: "4.22.20" } } });
    const validated = await api("POST", `/api/mirroring/profiles/${p.id}/preview`, {});
    assert.equal(validated.status, 400);
    assert.equal(validated.json.code, "PROFILE_NOT_READY");
    const draft = await api("POST", `/api/mirroring/profiles/${p.id}/preview-draft`, {});
    assert.equal(draft.status, 200, JSON.stringify(draft.json));
    assert.equal(draft.json.draft, true);
    assert.match(draft.json.imagesetConfig, /^# DRAFT — not runnable and not downloadable\./);
    assert.match(draft.json.imagesetConfig, /# Blocker: Lock the selected OpenShift release before generating platform content\./);
    assert.match(draft.json.imagesetConfig, /# Platform: release 4\.22\.20 is selected but not locked\./);
    assert.match(draft.json.imagesetConfig, /4\.22\.20/);
    assert.deepEqual(draft.json.blockers.map((b) => b.path), ["platform.version.locked"]);

    // Locked: the draft route refuses, and the validated body is the draft's body.
    assert.equal((await api("POST", `/api/mirroring/profiles/${p.id}/lock`, {})).status, 200);
    const ready = await api("POST", `/api/mirroring/profiles/${p.id}/preview`, {});
    assert.equal(ready.status, 200, JSON.stringify(ready.json));
    assert.equal(ready.json.imagesetConfig.trim(), body(draft.json.imagesetConfig).trim(), "same generator, same bytes");
    assert.equal((await api("POST", `/api/mirroring/profiles/${p.id}/preview-draft`, {})).json.code, "PROFILE_READY");
  });

  test("nothing renderable yet: no YAML, the blockers and what is left out — nothing invented", async () => {
    const p = await create({ content: { platform: true, additionalImages: true } });
    const draft = await api("POST", `/api/mirroring/profiles/${p.id}/preview-draft`, {});
    assert.equal(draft.status, 200);
    assert.equal(draft.json.imagesetConfig, null);
    assert.deepEqual(draft.json.omitted.map((o) => o.group).sort(), ["additionalImages", "platform"]);
    assert.ok(draft.json.blockers.length >= 2);
  });

  test("partly ready: the renderable group is shown, the other is named as left out", async () => {
    const p = await create({ content: { platform: true, additionalImages: true }, additionalImages: ["quay.io/org/app:v1"] });
    const draft = await api("POST", `/api/mirroring/profiles/${p.id}/preview-draft`, {});
    assert.match(draft.json.imagesetConfig, /quay\.io\/org\/app:v1/);
    assert.match(draft.json.imagesetConfig, /# Not shown: platform \(no OpenShift release and patch selected\)\./);
    assert.doesNotMatch(body(draft.json.imagesetConfig), /platform:/);
  });

  test("an unsupported minor is refused, as everywhere else (No Fallback)", async () => {
    const p = await create({ content: { operators: true }, operators: { catalogMinor: "4.22" } });
    // A 4.23 catalog minor cannot be saved; the draft route never relaxes the version guard.
    const bad = await api("POST", `/api/mirroring/profiles/${p.id}`, { operators: { catalogMinor: "4.23" } });
    assert.equal(bad.status, 422);
    const draft = await api("POST", `/api/mirroring/profiles/${p.id}/preview-draft`, {});
    assert.equal(draft.json.imagesetConfig, null);
    assert.deepEqual(draft.json.omitted.map((o) => o.group), ["operators"]);
  });
});
